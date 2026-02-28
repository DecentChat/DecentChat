export { RateLimiter, DEFAULT_LIMITS } from './RateLimiter';
export type {
  RateLimitAction, BucketConfig, ViolationSeverity,
  Violation, PeerReputation, RateLimitResult,
} from './RateLimiter';

export { MessageGuard } from './MessageGuard';
export type { SizeLimits, GuardResult } from './MessageGuard';

export { verifyHandshakeKey, verifyHandshake } from './HandshakeVerifier';
export type { HandshakeVerificationResult, VerifyHandshakeParams } from './HandshakeVerifier';

export { verifyPeerIdBinding } from './IdentityVerifier';
export type { PeerIdBindingResult } from './IdentityVerifier';

export { PeerAuth } from './PeerAuth';
export type { AuthChallenge, AuthResponse } from './PeerAuth';
