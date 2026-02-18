/**
 * MessageCipher - Handles message encryption/decryption and signing/verification
 */

import type { EncryptedData, SignedMessage } from './types';

export class MessageCipher {
  /**
   * Encrypt plaintext using AES-GCM with derived shared secret
   */
  async encrypt(plaintext: string, sharedSecret: CryptoKey): Promise<EncryptedData> {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    // Generate random IV (12 bytes for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt with AES-GCM
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128, // 128-bit authentication tag
      },
      sharedSecret,
      data
    );

    // Split ciphertext and auth tag
    const ciphertextArray = new Uint8Array(ciphertext);
    const ciphertextWithoutTag = ciphertextArray.slice(0, -16); // Last 16 bytes are the tag
    const tag = ciphertextArray.slice(-16);

    return {
      ciphertext: this.arrayBufferToBase64(ciphertextWithoutTag),
      iv: this.arrayBufferToBase64(iv),
      tag: this.arrayBufferToBase64(tag),
    };
  }

  /**
   * Decrypt ciphertext using AES-GCM with derived shared secret
   */
  async decrypt(encrypted: EncryptedData, sharedSecret: CryptoKey): Promise<string> {
    const ciphertext = this.base64ToArrayBuffer(encrypted.ciphertext);
    const iv = this.base64ToArrayBuffer(encrypted.iv);
    const tag = this.base64ToArrayBuffer(encrypted.tag);

    // Combine ciphertext and tag
    const combined = new Uint8Array(ciphertext.byteLength + tag.byteLength);
    combined.set(new Uint8Array(ciphertext), 0);
    combined.set(new Uint8Array(tag), ciphertext.byteLength);

    // Decrypt with AES-GCM
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
        tagLength: 128,
      },
      sharedSecret,
      combined
    );

    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  }

  /**
   * Sign data with ECDSA private key
   */
  async sign(data: string, privateKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      privateKey,
      dataBuffer
    );

    return this.arrayBufferToBase64(signature);
  }

  /**
   * Verify signature with ECDSA public key
   */
  async verify(data: string, signature: string, publicKey: CryptoKey): Promise<boolean> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const signatureBuffer = this.base64ToArrayBuffer(signature);

    return await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      publicKey,
      signatureBuffer,
      dataBuffer
    );
  }

  /**
   * Create signed message (data + signature)
   */
  async createSignedMessage(data: string, privateKey: CryptoKey): Promise<SignedMessage> {
    const signature = await this.sign(data, privateKey);
    return {
      data: btoa(data), // Base64 encode the data
      signature,
    };
  }

  /**
   * Verify signed message
   */
  async verifySignedMessage(
    signedMessage: SignedMessage,
    publicKey: CryptoKey
  ): Promise<string | null> {
    const data = atob(signedMessage.data);
    const isValid = await this.verify(data, signedMessage.signature, publicKey);

    if (!isValid) {
      return null;
    }

    return data;
  }

  // Utility methods for Base64 conversion
  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
