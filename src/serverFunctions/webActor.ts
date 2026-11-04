/** The signed-in caller of a project server function, for trusted research work. */
export const webActor = (context: {
  userId: string;
  userEmail: string;
  organizationId: string;
  role: string;
}) => ({
  userId: context.userId,
  userEmail: context.userEmail,
  organizationId: context.organizationId,
  role: context.role,
  surface: "web" as const,
});
