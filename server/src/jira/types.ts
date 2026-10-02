export interface JiraSearchResult {
  isLast?: boolean;
  nextPageToken?: string;
  startAt?: number;
  maxResults?: number;
  total?: number;
  issues: JiraIssue[];
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    priority?: { id?: string; name?: string };
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { accountId?: string; displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    components?: Array<{ name?: string }>;
    labels?: string[];
    duedate?: string | null;
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    customfield_10021?: Array<{ id?: string }> | null;
    [key: string]: unknown;
  };
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraCommentResponse {
  id: string;
}
