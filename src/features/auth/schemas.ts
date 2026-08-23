import { z } from "zod";

/**
 * Auth input contracts. Shared by the client form and the server action — the
 * client copy is a convenience for fast feedback, the server copy is the one
 * that counts. Never skip the server-side parse because the form already
 * validated: the form is not the only thing that can call an action.
 */

/**
 * Handles that would collide with a route, impersonate the platform, or make a
 * profile URL ambiguous. Kept here rather than in the database so a new route
 * cannot silently become squattable.
 */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "settings",
  "support",
  "help",
  "about",
  "terms",
  "privacy",
  "dashboard",
  "discover",
  "search",
  "leaderboard",
  "library",
  "stats",
  "statistics",
  "wrapped",
  "shows",
  "show",
  "anime",
  "tv",
  "users",
  "user",
  "u",
  "me",
  "feed",
  "moderator",
  "mod",
  "staff",
  "system",
  "root",
  "null",
  "undefined",
  "watchgoblin",
  "goblin",
  "official",
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Usernames need at least 3 characters.")
  .max(24, "Usernames cap out at 24 characters.")
  .regex(
    /^[a-z0-9_]+$/,
    "Letters, numbers and underscores only. No spaces, no chaos.",
  )
  .refine((value) => !/^_+$/.test(value), "That is just underscores.")
  .refine((value) => !RESERVED_USERNAMES.has(value), "That username is reserved.");

export const emailSchema = z
  .email("That does not look like an email.")
  .trim()
  .toLowerCase()
  .max(254);

/**
 * Length is the only hard requirement, deliberately. Composition rules
 * (a symbol, a digit, a capital) push people toward `Password1!` and measurably
 * do not help; length plus a breach check is the modern guidance. What we do
 * enforce is that the password is not one of the handful of passwords everyone
 * picks.
 */
const WORST_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwertyuiop",
  "iloveyou",
  "letmein",
  "changeme",
  "watchgoblin",
]);

export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters. Yes, really.")
  .max(200, "That is a novel, not a password.")
  .refine(
    (value) => !WORST_PASSWORDS.has(value.toLowerCase()),
    "That password is on every leaked-password list on earth. Pick another.",
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Pick a display name.")
  .max(40, "Display names cap out at 40 characters.");

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    displayName: displayNameSchema.optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Those two passwords are not the same.",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const confirmPasswordResetSchema = z
  .object({
    token: z.string().min(10, "That reset link is not valid."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Those two passwords are not the same.",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Those two passwords are not the same.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "That is your current password.",
    path: ["newPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
