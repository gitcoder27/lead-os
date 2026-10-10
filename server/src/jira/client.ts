import { assertAllowedOutboundUrl } from "../net/outbound-guard";
import { logger } from "../utils/logger";
import { JiraIssue, JiraSearchResult, JiraUser, JiraTransition } from "./types";

const JIRA_REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export class JiraClient {
  private readonly authHeader: string;
  private readonly normalizedBaseUrl: string;

  constructor(
    baseUrl: string,
    private readonly email: string,
    private readonly apiToken: string,
  ) {
    this.normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  private async request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
    if (!this.normalizedBaseUrl) {
      throw new Error("Jira base URL is not configured. Set a valid JIRA_BASE_URL or jiraBaseUrl in setup.");
    }

    let requestUrl: string;
    try {
      requestUrl = new URL(path, this.normalizedBaseUrl).toString();
    } catch (error) {
      throw new Error("Invalid Jira request URL");
    }

    await assertAllowedOutboundUrl(requestUrl, "jira");
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Jira request timed out", "TimeoutError"));
    }, JIRA_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        ...init,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(`Jira request timed out after ${JIRA_REQUEST_TIMEOUT_MS}ms`);
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Jira request was aborted`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429 && allowRetry) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
      logger.warn({ retryAfter }, "Jira rate-limited; retrying once");
      await sleep(retryAfter * 1000);
      return this.request<T>(path, init, false);
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401) {
        throw new Error("Jira authentication failed (401)");
      }
      if (response.status === 403) {
        throw new Error("Jira access denied (403)");
      }
      if (response.status === 404) {
        throw new Error("Jira resource not found (404)");
      }
      throw new Error(`Jira API error (${response.status})`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async searchIssues(jql: string, fields: string[], maxResults = 100): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    let nextPageStartAt = 0;

    while (true) {
      const payload: Record<string, unknown> = {
        jql,
        fields,
        maxResults,
      };

      if (nextPageToken) {
        payload.nextPageToken = nextPageToken;
      } else if (nextPageStartAt > 0) {
        payload.startAt = nextPageStartAt;
      }

      const page = await this.request<JiraSearchResult>("/rest/api/3/search/jql", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      logger.info(
        {
          fetched: page.issues.length,
          total: page.total ?? undefined,
          isLast: page.isLast ?? undefined,
          startAt: page.startAt ?? undefined,
        },
        "Fetched Jira issue page"
      );
      all.push(...page.issues);

      if (page.isLast === true) {
        break;
      }

      if (page.nextPageToken) {
        nextPageToken = page.nextPageToken;
        continue;
      }

      if (typeof page.startAt === "number" && typeof page.total === "number") {
        nextPageStartAt = page.startAt + page.issues.length;
        if (nextPageStartAt >= page.total || page.issues.length === 0) {
          break;
        }
        continue;
      }

      if (page.issues.length === 0) {
        break;
      }
      break;
    }

    return all;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
  }

  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.request<void>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.request<{ transitions?: JiraTransition[] }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`,
    );
    return response.transitions ?? [];
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request<void>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      { method: 'POST', body: JSON.stringify({ transition: { id: transitionId } }) },
      false,
    );
  }

  async addComment(issueKey: string, text: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        },
      }),
    });
  }

  async getAssignableUsers(
    projectKey: string,
    options?: { query?: string; startAt?: number; maxResults?: number }
  ): Promise<JiraUser[]> {
    const qs = new URLSearchParams({ project: projectKey });
    if (options?.query?.trim()) {
      qs.set("query", options.query.trim());
    }
    if (typeof options?.startAt === "number") {
      qs.set("startAt", String(options.startAt));
    }
    if (typeof options?.maxResults === "number") {
      qs.set("maxResults", String(options.maxResults));
    }
    return this.request<JiraUser[]>(`/rest/api/3/user/assignable/search?${qs.toString()}`);
  }

  async getCurrentUser(): Promise<JiraUser> {
    return this.request<JiraUser>("/rest/api/3/myself");
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request("/rest/api/3/myself");
      return true;
    } catch {
      return false;
    }
  }

  async getFields(): Promise<Array<{ id: string; name: string; custom: boolean }>> {
    const fields = await this.request<Array<{ id: string; name: string; custom: boolean }>>("/rest/api/3/field");
    return fields.map((f) => ({ id: f.id, name: f.name, custom: f.custom }));
  }
}
