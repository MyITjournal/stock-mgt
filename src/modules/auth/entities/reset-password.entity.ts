export class ResetPassword {
  id: string;
  userId: string;
  tokenSelector: string;
  tokenHash: string;
  used: boolean;
  expiresAt: Date;
  createdAt: Date;
}
