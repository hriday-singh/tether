import crypto from 'node:crypto';
import * as jose from 'jose';

export interface RoomTokenClaims {
  sub: string; // memberId
  aud: string; // room:<roomId>
  name: string; // displayName
  pv: number; // passcodeVersion
  ep: string; // roomEpoch
  iat?: number;
  exp?: number;
}

export class JoinService {
  private jwtSecretBytes: Uint8Array;

  constructor(jwtSecret: string) {
    if (jwtSecret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.jwtSecretBytes = new TextEncoder().encode(jwtSecret);
  }

  /**
   * Hashes a passcode using scrypt: N=2^15 (32768), r=8, p=1, 16-byte salt, 32-byte key.
   * Format: "scrypt$32768$8$1$<saltB64>$<keyB64>"
   */
  public async hashPasscode(passcode: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(passcode, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });

    return `scrypt$32768$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /**
   * Verifies a passcode against a stored hash using timingSafeEqual.
   */
  public async verifyPasscode(passcode: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }

    const N = parseInt(parts[1]!, 10);
    const r = parseInt(parts[2]!, 10);
    const p = parseInt(parts[3]!, 10);
    const salt = Buffer.from(parts[4]!, 'base64');
    const expectedKey = Buffer.from(parts[5]!, 'base64');

    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(passcode, salt, expectedKey.length, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    if (derivedKey.length !== expectedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, expectedKey);
  }

  /**
   * Issues a room session token (HS256 JWT valid for 24h).
   */
  public async issueRoomToken(claims: {
    memberId: string;
    roomId: string;
    displayName: string;
    passcodeVersion: number;
    roomEpoch: string;
  }): Promise<string> {
    return await new jose.SignJWT({
      name: claims.displayName,
      pv: claims.passcodeVersion,
      ep: claims.roomEpoch,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.memberId)
      .setAudience(`room:${claims.roomId}`)
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(this.jwtSecretBytes);
  }

  /**
   * Verifies and decodes a room session token.
   */
  public async verifyRoomToken(token: string, expectedRoomId: string): Promise<RoomTokenClaims> {
    const { payload } = await jose.jwtVerify(token, this.jwtSecretBytes, {
      audience: `room:${expectedRoomId}`,
    });

    return {
      sub: payload.sub!,
      aud: payload.aud as string,
      name: payload['name'] as string,
      pv: payload['pv'] as number,
      ep: payload['ep'] as string,
      iat: payload.iat,
      exp: payload.exp,
    };
  }
}
