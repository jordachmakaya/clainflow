import { ClaimStatus, Role } from '../../generated/prisma/enums.js';
import type { AuthUser } from '../auth/auth.types.js';

// 👁️ QUI voit QUEL dossier. Une seule source de vérité, utilisée de deux façons :
//   - canViewClaim : contrôle d'UN dossier déjà chargé ;
//   - visibilityScope : filtre traduit en clause WHERE pour les LISTES (par le repository).

/** La corbeille des gestionnaires : les dossiers sans gestionnaire encore dans cet état. */
export const HANDLER_QUEUE_STATUS = ClaimStatus.DECLARED

export interface ClaimOwnerShip{
    declarantId:string;
    handlerId: string | null;
    expertId:string | null;
    status: ClaimStatus;
}

export type VisibilitéScope =
    | {kind: 'all'}
    | {kind: 'declarant'; userId:string}
    | {kind: 'handler'; userId:string; queueStatus:ClaimStatus}
    | {kind: 'expert'; userId:string};

export function visibilitéScope(user:AuthUser):VisibilitéScope{
    switch (user.role){
        case Role.ADMIN:
            return {kind: 'all'}
        case Role.POLICYHOLDER:
            return {kind: 'declarant', userId:user.id}
        case Role.HANDLER:
            return {kind: 'handler', userId:user.id, queueStatus:HANDLER_QUEUE_STATUS}
        case Role.EXPERT:
            return {kind: 'expert', userId:user.id}
    }
}

export function  canViewClaim(user:AuthUser, claim:ClaimOwnerShip):boolean{
    const scope = visibilitéScope(user)
    switch (scope.kind) {
        case 'all':
            return true
        case 'declarant':
            return claim.declarantId === scope.userId
        case 'handler':
            return (
                claim.handlerId === scope.userId ||
                (claim.handlerId === null && claim.status === scope.queueStatus)
            )
        case 'expert':
            return claim.expertId === scope.userId
    }
}