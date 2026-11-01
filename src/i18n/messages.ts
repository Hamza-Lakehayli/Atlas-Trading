import "server-only";

export async function getMessages(locale: string) {
  if (locale === "fr") return (await import("../../messages/fr.json")).default;
  return (await import("../../messages/en.json")).default;
}
