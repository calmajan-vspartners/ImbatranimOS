import { IsOptional, IsString, MinLength } from 'class-validator';

export class SetupDto {
  // Full strength enforcement lives in AuthService; the DTO does the cheap
  // structural check so obviously-bad input is rejected before hashing.
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  password: string;

  // Present only when the operator set SETUP_TOKEN; gates first-run claim.
  @IsOptional()
  @IsString()
  token?: string;
}

export class LoginDto {
  @IsString()
  password: string;

  // Present only when TOTP is enabled for the account.
  @IsOptional()
  @IsString()
  token?: string;
}

export class TotpTokenDto {
  @IsString()
  token: string;
}

// Enrolling (like disabling) requires re-proving the current password, so a
// stolen session alone cannot rotate the TOTP secret / silently drop 2FA.
export class EnrollTotpDto {
  @IsString()
  password: string;
}

export class DisableTotpDto {
  @IsString()
  password: string;
}

/**
 * Rotate the password.
 *
 * `currentPassword` carries no `MinLength`: the stored password predates any rule
 * change, and rejecting it structurally would leak that it is too short before it
 * is even verified. The new one gets the same ≥10 check as first-run, and
 * `AuthService` enforces the real rule regardless.
 */
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  newPassword: string;

  // Required by the service when TOTP is enabled; optional in the shape because
  // most installs have it off.
  @IsOptional()
  @IsString()
  token?: string;
}
