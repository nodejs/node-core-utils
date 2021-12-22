export function isTheSamePerson(actor, b) {
  if (!actor || !actor.login) return false; // ghost
  return actor.login.toLowerCase() === b.toLowerCase();
}
