/** Read-side identity only: explicit assignments keep the manager login id. */
export const isTaskSelf = (id: string | null | undefined, loginId?: string, developerId?: string) =>
  Boolean(id && (id === loginId || id === developerId));
