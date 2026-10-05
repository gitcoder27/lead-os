import { isTaskHidden, type ProjectDetail, type ProjectFacts, type TaskViewTask } from "shared/types";
import { ProjectsService } from "./projects.service";
import type { TaskPrincipal } from "./task.service";
import { TaskViewsService } from "./task-views.service";
import { todayIsoDate } from "../utils/date";

export const projectFacts = (tasks: TaskViewTask[], today: string): ProjectFacts => {
  const attention = tasks.filter(
    (task) => !isTaskHidden({ later: task.later, hideUntil: task.hideUntil ?? null }, today),
  );
  const checks = attention
    .filter((task) => task.followUpAt)
    .sort((a, b) => Date.parse(a.followUpAt!) - Date.parse(b.followUpAt!) || a.taskKey.localeCompare(b.taskKey));
  const first = checks[0];
  return {
    open: tasks.length,
    blocked: attention.filter((task) => task.status === "blocked").length,
    overdue: attention.filter((task) => task.signals.overdue).length,
    followUpDue: attention.filter((task) => task.followUpAt && task.signals.followUpDue).length,
    nextCheck: first ? { taskKey: first.taskKey, title: first.title, at: first.followUpAt! } : null,
  };
};
export class ProjectFactsService {
  private readonly containers = new ProjectsService();
  async list(actor: TaskPrincipal, archived = false, today = todayIsoDate(), tz?: string) {
    const projects = await this.containers.list(actor, archived);
    if (!projects.length) return [];
    const tasks = await new TaskViewsService().run(actor, {}, today, tz);
    return projects.map((project) => ({
      ...project,
      facts: projectFacts(
        tasks.filter((task) => task.placement?.projectId === project.id),
        today,
      ),
    }));
  }
  async detail(actor: TaskPrincipal, id: number, today = todayIsoDate(), tz?: string): Promise<ProjectDetail> {
    const project = await this.containers.requireProject(actor, id);
    const tracks = await this.containers.tracks(actor, id);
    const tasks = await new TaskViewsService().run(actor, { filters: { project: id } }, today, tz);
    return {
      project,
      facts: projectFacts(tasks, today),
      tracks: tracks.map((track) => ({
        ...track,
        facts: projectFacts(
          tasks.filter((task) => task.placement?.trackId === track.id),
          today,
        ),
      })),
    };
  }
}
