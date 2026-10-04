import type { DueDateSuggestion, PrioritySuggestion } from "shared/types";
import { addDays, addHours, todayIsoDate } from "../utils/date";
import { WorkloadService } from "./workload.service";

export class AutomationService {
  constructor(private readonly workloadService: WorkloadService) {}

  suggestPriority(labels: string[]): PrioritySuggestion {
    const normalized = labels.map((label) => label.toLowerCase());

    if (normalized.includes("production") || normalized.includes("prod-bug")) {
      return { suggested: "Highest", reason: "Production-impacting label detected." };
    }
    if (normalized.includes("customer") || normalized.includes("client")) {
      return { suggested: "High", reason: "Customer-impacting label detected." };
    }
    return { suggested: "Medium", reason: "Default suggestion for general defects.", isDefault: true };
  }

  /** `today` is the caller's day; a target that has already passed is never proposed (docs/56 UX-32). */
  suggestDueDate(priorityName: string, createdAt: string, today: string = todayIsoDate()): DueDateSuggestion {
    const created = new Date(createdAt);
    let suggestedDate = created;
    let reason = "";

    switch (priorityName) {
      case "Highest":
        suggestedDate = addHours(created, 24);
        reason = "Highest priority target is 24 hours from creation.";
        break;
      case "High":
        suggestedDate = addDays(created, 3);
        reason = "High priority target is 3 calendar days from creation.";
        break;
      case "Medium":
        suggestedDate = addDays(created, 7);
        reason = "Medium priority target is 7 calendar days from creation.";
        break;
      case "Low":
      case "Lowest":
      default:
        suggestedDate = addDays(created, 14);
        reason = "Low/Lowest priority target is 14 calendar days from creation.";
        break;
    }

    const suggested = suggestedDate.toISOString().slice(0, 10);
    if (suggested < today) {
      return { suggested: null, reason: `${reason} That target has already passed, so no date is suggested.` };
    }
    return { suggested, reason };
  }

  async suggestAssignee(workspaceId?: string) {
    return this.workloadService.suggestAssignee(workspaceId);
  }
}
