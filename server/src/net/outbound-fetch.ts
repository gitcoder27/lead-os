import { Agent } from "undici";
import { lookup } from "node:dns/promises";
import { assertAllowedOutboundUrl, assertAllowedOutboundAddresses } from "./outbound-guard";

/** Each connection resolves and vets once; the connector uses exactly those answers.
 * The URL/hostname stay intact for Host, SNI and certificate verification.
 * A request owns its dispatcher so pooled sockets cannot outlive its policy check.
 */
export async function outboundFetch(url: string, purpose: "jira" | "ai", init: RequestInit): Promise<Response> {
  await assertAllowedOutboundUrl(url, purpose);
  const dispatcher = new Agent({ connect: {
    lookup: (hostname, options, callback) => {
      lookup(hostname, { all: true, verbatim: true }).then(answers => {
        assertAllowedOutboundAddresses(hostname, answers.map(answer => answer.address));
        if (options.all) callback(null, answers);
        else callback(null, answers[0]!.address, answers[0]!.family);
      }).catch(error => callback(error, "", 4));
    },
  } });
  try {
    const response = await fetch(url, { ...init, redirect: "manual", dispatcher } as RequestInit);
    // close drains active bodies (including SSE); it does not abort their consumption.
    void dispatcher.close().catch(() => dispatcher.destroy());
    return response;
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
}
