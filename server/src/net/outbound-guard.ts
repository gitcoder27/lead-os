import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { config } from "../config";
import { HttpError } from "../middleware/errorHandler";

type OutboundPurpose = "jira" | "ai";
const denied = () => new HttpError(400, "That address isn't allowed. Use a public https address.");
const hostRules = (value: string | undefined) => (value ?? "").split(",").map((rule) => rule.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);

/** A leading dot permits the apex and its subdomains, never a lookalike suffix. */
export function matchesOutboundHost(host: string, rule: string): boolean {
  return rule.startsWith(".") ? host === rule.slice(1) || host.endsWith(rule) : host === rule;
}

export function isPublicOutboundAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === "unicast";
}

/** Save, test and request paths share this policy; redirects are refused by callers. */
export async function assertAllowedOutboundUrl(value: string, purpose: OutboundPurpose): Promise<void> {
  let url: URL;
  try { url = new URL(value); } catch { throw denied(); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw denied();
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (purpose === "jira") {
    const jiraHosts = hostRules(process.env.JIRA_ALLOWED_HOSTS);
    if (jiraHosts.length && !jiraHosts.some((rule) => matchesOutboundHost(host, rule))) throw denied();
  }
  if (config.NODE_ENV !== "production") return;
  if (url.protocol !== "https:") throw denied();
  const exceptions = hostRules(process.env.OUTBOUND_ALLOWED_HOSTS);
  if (exceptions.some((rule) => matchesOutboundHost(host, rule))) return;
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((answer) => answer.address);
  } catch { throw denied(); }
  if (!addresses.length || addresses.some((address) => !isPublicOutboundAddress(address))) throw denied();
}
