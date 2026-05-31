/**
 * sanitizeUser — devuelve un user "publicable" al cliente.
 *
 * NUNCA exponer estos campos al frontend:
 *   - password               → hash bcrypt; salir solo se usa para validar internamente
 *   - totp_secret            → secreto compartido TOTP; exponerlo rompe 2FA al instante
 *   - failed_login_attempts  → revela el estado del rate-limit / progreso de un brute-force
 *   - locked_until           → revela ventana de lockout
 *
 * Conviértelo en el único helper para "user → response" en TODO el código.
 * Usar `select` en Prisma queries es mejor aún, pero este helper es la red
 * de seguridad final.
 */
export function sanitizeUser(user: any) {
  if (!user) return user;
  const {
    password,
    totp_secret,
    failed_login_attempts,
    locked_until,
    ...rest
  } = user;
  return {
    ...rest,
    balance: rest.balance !== undefined && rest.balance !== null
      ? Number(rest.balance)
      : rest.balance,
  };
}
