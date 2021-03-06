var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as sodium from 'libsodium-wrappers';
import * as pbkdf2 from 'pbkdf2';
import * as elliptic from 'elliptic';
import toBuffer from 'typedarray-to-buffer';
import utility from './utility';
import { prefix } from './constants';
/**
 * Creates a key object from a base58 encoded key.
 * @class Key
 * @param {Object} KeyConstructor
 * @param {string} [KeyConstructor.key] A public or secret key in base58 encoding, or a 15 word bip39 english mnemonic string.
 * @param {string} [KeyConstructor.passphrase] The passphrase used if the key provided is an encrypted private key or a fundraiser key
 * @param {string} [KeyConstructor.email] Email used if a fundraiser key is
 * @example
 * const key = new Key({ key: 'edskRv6ZnkLQMVustbYHFPNsABu1Js6pEEWyMUFJQTqEZjVCU2WHh8ckcc7YA4uBzPiJjZCsv3pC1NDdV99AnyLzPjSip4uC3y' });
 * await key.ready;
 *
 * await key.ready;
 */
export default class Key {
    constructor({ key, passphrase, email, } = {}) {
        /**
         * @memberof Key
         * @description Returns the public key
         * @returns {string} The public key associated with the private key
         */
        this.publicKey = () => utility.b58cencode(this._publicKey, prefix[`${this._curve}pk`]);
        /**
         * @memberof Key
         * @description Returns the secret key
         * @returns {string} The secret key associated with this key, if available
         */
        this.secretKey = () => {
            if (!this._secretKey) {
                throw new Error('Secret key not known.');
            }
            let key = this._secretKey;
            if (this._curve === 'ed') {
                const { privateKey } = sodium.crypto_sign_seed_keypair(key.slice(0, 32));
                key = toBuffer(privateKey);
            }
            return utility.b58cencode(key, prefix[`${this._curve}sk`]);
        };
        /**
         * @memberof Key
         * @description Returns public key hash for this key
         * @returns {string} The public key hash for this key
         */
        this.publicKeyHash = () => {
            const prefixMap = {
                ed: prefix.tz1,
                sp: prefix.tz2,
                p2: prefix.tz3,
            };
            const _prefix = prefixMap[this._curve];
            return utility.b58cencode(sodium.crypto_generichash(20, this._publicKey), _prefix);
        };
        this.initialize = ({ key, passphrase, email, }, ready) => __awaiter(this, void 0, void 0, function* () {
            yield sodium.ready;
            if (!key) {
                throw new Error('Invalid key provided.');
            }
            if (email) {
                if (!passphrase) {
                    throw new Error('Fundraiser key provided without a passphrase.');
                }
                const salt = utility
                    .textDecode(utility.textEncode(`${email}${passphrase}`))
                    .normalize('NFKD');
                const seed = pbkdf2.pbkdf2Sync(key, `mnemonic${salt}`, 2048, 64, 'sha512');
                const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(seed.slice(0, 32));
                this._publicKey = toBuffer(publicKey);
                this._secretKey = toBuffer(privateKey);
                this._curve = 'ed';
                this._isSecret = true;
                ready();
                return;
            }
            this._curve = key.substr(0, 2);
            if (!['sp', 'p2', 'ed'].includes(this._curve)) {
                throw new Error('Invalid prefix for a key encoding.');
            }
            if (![54, 55, 88, 98].includes(key.length)) {
                throw new Error('Invalid length for a key encoding');
            }
            const encrypted = key.substring(2, 3) === 'e';
            const publicOrSecret = encrypted ? key.slice(3, 5) : key.slice(2, 4);
            if (!['pk', 'sk'].includes(publicOrSecret)) {
                throw new Error('Invalid prefix for a key encoding.');
            }
            this._isSecret = publicOrSecret === 'sk';
            let constructedKey;
            if (this._isSecret) {
                constructedKey = utility.b58cdecode(key, prefix[`${this._curve}${encrypted ? 'e' : ''}sk`]);
            }
            else {
                constructedKey = utility.b58cdecode(key, prefix[`${this._curve}pk`]);
            }
            if (encrypted) {
                if (!passphrase) {
                    throw new Error('Encrypted key provided without a passphrase.');
                }
                const salt = toBuffer(constructedKey.slice(0, 8));
                const encryptedSk = constructedKey.slice(8);
                const encryptionKey = pbkdf2.pbkdf2Sync(passphrase, salt, 32768, 32, 'sha512');
                constructedKey = sodium.crypto_secretbox_open_easy(encryptedSk, new Uint8Array(24), encryptionKey);
            }
            if (!this._isSecret) {
                this._publicKey = toBuffer(constructedKey);
                this._secretKey = undefined;
            }
            else {
                this._secretKey = toBuffer(constructedKey);
                if (this._curve === 'ed') {
                    if (constructedKey.length === 64) {
                        this._publicKey = toBuffer(constructedKey.slice(32));
                    }
                    else {
                        const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(constructedKey, 'uint8array');
                        this._publicKey = toBuffer(publicKey);
                        this._secretKey = toBuffer(privateKey);
                    }
                }
                else if (this._curve === 'sp') {
                    const keyPair = new elliptic.ec('secp256k1').keyFromPrivate(constructedKey);
                    const prefixVal = keyPair
                        .getPublic()
                        .getY()
                        .toArray()[31] % 2
                        ? 3
                        : 2;
                    this._publicKey = toBuffer(new Uint8Array([prefixVal].concat(keyPair
                        .getPublic()
                        .getX()
                        .toArray())));
                }
                else if (this._curve === 'p2') {
                    const keyPair = new elliptic.ec('p256').keyFromPrivate(constructedKey);
                    const prefixVal = keyPair
                        .getPublic()
                        .getY()
                        .toArray()[31] % 2
                        ? 3
                        : 2;
                    this._publicKey = toBuffer(new Uint8Array([prefixVal].concat(keyPair
                        .getPublic()
                        .getX()
                        .toArray())));
                }
                else {
                    throw new Error('Invalid key');
                }
            }
            ready();
        });
        /**
         * @memberof Key
         * @description Sign a raw sequence of bytes
         * @param {string} bytes Sequence of bytes, raw format or hexadecimal notation
         * @param {Uint8Array} watermark The watermark bytes
         * @returns {Promise} The signature object
         */
        this.sign = (bytes, watermark) => __awaiter(this, void 0, void 0, function* () {
            let bb = utility.hex2buf(bytes);
            if (typeof watermark !== 'undefined') {
                bb = utility.mergebuf(watermark, bb);
            }
            const bytesHash = toBuffer(sodium.crypto_generichash(32, bb));
            if (!this._secretKey) {
                throw new Error('Cannot sign operations without a secret key.');
            }
            if (this._curve === 'ed') {
                const signature = sodium.crypto_sign_detached(bytesHash, this._secretKey);
                const signatureBuffer = toBuffer(signature);
                const sbytes = bytes + utility.buf2hex(signatureBuffer);
                return {
                    bytes,
                    sig: utility.b58cencode(signature, prefix.sig),
                    prefixSig: utility.b58cencode(signature, prefix.edsig),
                    sbytes,
                };
            }
            if (this._curve === 'sp') {
                const key = new elliptic.ec('secp256k1').keyFromPrivate(this._secretKey);
                const sig = key.sign(bytesHash, { canonical: true });
                const signature = new Uint8Array(sig.r.toArray(undefined, 32).concat(sig.s.toArray(undefined, 32)));
                const signatureBuffer = toBuffer(signature);
                const sbytes = bytes + utility.buf2hex(signatureBuffer);
                return {
                    bytes,
                    sig: utility.b58cencode(signature, prefix.sig),
                    prefixSig: utility.b58cencode(signature, prefix.spsig),
                    sbytes,
                };
            }
            if (this._curve === 'p2') {
                const key = new elliptic.ec('p256').keyFromPrivate(this._secretKey);
                const sig = key.sign(bytesHash, { canonical: true });
                const signature = new Uint8Array(sig.r.toArray(undefined, 32).concat(sig.s.toArray(undefined, 32)));
                const signatureBuffer = toBuffer(signature);
                const sbytes = bytes + utility.buf2hex(signatureBuffer);
                return {
                    bytes,
                    sig: utility.b58cencode(signature, prefix.sig),
                    prefixSig: utility.b58cencode(signature, prefix.p2sig),
                    sbytes,
                };
            }
            throw new Error('Provided curve not supported');
        });
        /**
         * @memberof Key
         * @description Verify signature, throw error if it is not valid
         * @param {string} bytes Sequance of bytes, raw format or hexadecimal notation
         * @param {Uint8Array} signature A signature in base58 encoding
         * @param {string} signature A signature in base58 encoding
         */
        this.verify = (bytes, signature, publicKey = this.publicKey()) => {
            if (!publicKey) {
                throw new Error('Cannot verify without a public key');
            }
            const _publicKey = toBuffer(utility.b58cdecode(publicKey, prefix[`${this._curve}pk`]));
            if (signature.slice(0, 3) !== 'sig') {
                if (this._curve !== signature.slice(0, 2)) {
                    // 'sp', 'p2' 'ed'
                    throw new Error('Signature and public key curves mismatch.');
                }
            }
            const bytesBuffer = sodium.crypto_generichash(32, utility.hex2buf(bytes));
            const sig = utility.b58cdecode(signature, prefix.sig);
            if (this._curve === 'ed') {
                try {
                    return sodium.crypto_sign_verify_detached(sig, bytesBuffer, _publicKey);
                }
                catch (e) {
                    return false;
                }
            }
            else if (this._curve === 'sp') {
                const key = new elliptic.ec('secp256k1').keyFromPublic(_publicKey);
                const formattedSig = utility.buf2hex(toBuffer(sig));
                // @ts-ignore
                const [r, s] = formattedSig.match(/([a-f\d]{64})/gi);
                try {
                    return key.verify(bytesBuffer, { r, s });
                }
                catch (e) {
                    return false;
                }
            }
            else if (this._curve === 'p2') {
                const key = new elliptic.ec('p256').keyFromPublic(_publicKey);
                const formattedSig = utility.buf2hex(toBuffer(sig));
                // @ts-ignore
                const [r, s] = formattedSig.match(/([a-f\d]{64})/gi);
                try {
                    return key.verify(bytesBuffer, { r, s });
                }
                catch (e) {
                    return false;
                }
            }
            else {
                throw new Error(`Curve '${this._curve}' not supported`);
            }
        };
        this.ready = new Promise(resolve => {
            this.initialize({ key, passphrase, email }, resolve);
        });
    }
    get curve() {
        return this._curve;
    }
}
