// How a person is shown to others: their name (docs/api/auth.md §1, "Name"),
// else their email, which stays their login.
export const personLabel = (u: { email: string; name: string | null }): string => u.name ?? u.email;
