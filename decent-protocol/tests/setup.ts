/**
 * Test setup - provides browser globals (window, crypto, indexedDB)
 */

import { Window } from 'happy-dom';

// Create a happy-dom window for DOM globals
const window = new Window();

// Set up browser globals
(global as any).window = window;
(global as any).document = window.document;
(global as any).navigator = window.navigator;
(global as any).location = window.location;

// Use Node.js webcrypto for crypto operations (better compatibility)
import { webcrypto } from 'crypto';
(global as any).crypto = webcrypto;
(window as any).crypto = webcrypto;

// Use fake-indexeddb for proper IndexedDB support in Node environment
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const fakeIDB = new IDBFactory();
(global as any).indexedDB = fakeIDB;
(global as any).IDBKeyRange = IDBKeyRange;
