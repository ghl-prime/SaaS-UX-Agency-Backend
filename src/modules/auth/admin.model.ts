import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { PERMISSIONS, ROLES, effectivePermissions, type Permission, type Role } from '../../config/permissions.js';

export const ADMIN_STATUSES = ['active', 'invited', 'disabled'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export interface Admin {
  email: string;
  name: string;
  /** Empty until an invited user accepts and picks a password. */
  passwordHash?: string;
  role: Role;
  /** Granted areas for `admin`; ignored for `developer` (always everything). */
  permissions: Permission[];
  status: AdminStatus;
  /** Bumped on password change/reset: every session signed with an older version stops working. */
  sessionVersion: number;
  inviteTokenHash?: string | null;
  inviteExpiresAt?: Date | null;
  resetTokenHash?: string | null;
  resetExpiresAt?: Date | null;
  invitedBy?: Types.ObjectId | null;
  lastLoginAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AdminMethods {
  verifyPassword(password: string): Promise<boolean>;
}

type AdminModel = Model<Admin, object, AdminMethods> & {
  hashPassword(password: string): Promise<string>;
};

export type AdminDocument = HydratedDocument<Admin, AdminMethods>;

const adminSchema = new Schema<Admin, AdminModel, AdminMethods>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'admin' },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    status: { type: String, enum: ADMIN_STATUSES, default: 'active', index: true },
    sessionVersion: { type: Number, default: 0 },
    inviteTokenHash: { type: String, default: null, index: true, select: false },
    inviteExpiresAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null, index: true, select: false },
    resetExpiresAt: { type: Date, default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

adminSchema.method('verifyPassword', function (this: AdminDocument, password: string) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(password, this.passwordHash);
});

adminSchema.static('hashPassword', (password: string) => bcrypt.hash(password, 12));

export const AdminModel = model<Admin, AdminModel>('Admin', adminSchema);

/** One-time tokens: the raw value goes in the email link, only its hash is stored. */
export function createOneTimeToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Readable random password: 16 chars from an unambiguous alphabet, with digit + symbol. */
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!@#$%&*?';
  const chars = Array.from(crypto.randomBytes(length), (b) => alphabet[b % alphabet.length]);
  chars[crypto.randomInt(length)] = symbols[crypto.randomInt(symbols.length)];
  chars[crypto.randomInt(length)] = String(crypto.randomInt(2, 10));
  return chars.join('');
}

type AdminLike = Pick<Admin, 'email' | 'name' | 'role' | 'permissions' | 'status' | 'lastLoginAt' | 'createdAt' | 'inviteExpiresAt'> & { _id: unknown };

export function toPublicAdmin(admin: AdminLike) {
  return {
    id: String(admin._id),
    email: admin.email,
    name: admin.name,
    role: admin.role,
    permissions: effectivePermissions(admin.role, admin.permissions),
    status: admin.status ?? 'active',
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt ?? null,
    inviteExpiresAt: admin.status === 'invited' ? (admin.inviteExpiresAt ?? null) : null,
  };
}
