// the web form and registration function use the same exact-domain rule
export function isNusStudentEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@u\.nus\.edu$/.test(email);
}
