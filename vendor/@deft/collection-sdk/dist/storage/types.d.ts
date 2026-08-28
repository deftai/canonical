/** Install id + bearer-equivalent token, the two values every authenticated call needs. */
export interface StoredCredentials {
    installId: string;
    token: string;
}
export interface CredentialStorage {
    load(): Promise<StoredCredentials | null>;
    save(creds: StoredCredentials): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map