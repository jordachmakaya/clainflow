export interface AuthUser{
    id: string;
    role: string;
}

declare global {
    namespace Express {
        interface Locals {
            auth?: AuthUser;
        }
    }
}