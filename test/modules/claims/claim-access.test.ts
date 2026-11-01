import {describe, expect, it} from "vitest";
import {ClaimStatus, Role} from "../../../src/generated/prisma/enums.js";
import {
    canViewClaim,
    HANDLER_QUEUE_STATUS,
    visibilitéScope,
    type ClaimOwnerShip,
} from "../../../src/modules/claims/claim-access.js";

const USER_ID = '01900000-0000-7000-8000-000000000001';
const OTHER_ID = '01900000-0000-7000-8000-000000000002';

const claim = (overrides: Partial<ClaimOwnerShip> = {}): ClaimOwnerShip => ({
    declarantId: OTHER_ID,
    handlerId: OTHER_ID,
    expertId: OTHER_ID,
    status: ClaimStatus.UNDER_REVIEW,
    ...overrides,
});

describe('visibilitéScope', () => {
    it('donne tout à l\'admin', () => {
        expect(visibilitéScope({id: USER_ID, role: Role.ADMIN})).toEqual({kind: 'all'});
    });

    it.each([
        [Role.POLICYHOLDER, 'declarant'],
        [Role.EXPERT, 'expert'],
    ])('limite le rôle %s à ses dossiers', (role, kind) => {
        expect(visibilitéScope({id: USER_ID, role})).toEqual({kind, userId: USER_ID});
    });

    it('porte la corbeille dans le filtre du gestionnaire', () => {
        expect(visibilitéScope({id: USER_ID, role: Role.HANDLER})).toEqual({
            kind: 'handler',
            userId: USER_ID,
            queueStatus: HANDLER_QUEUE_STATUS,
        });
    });
});

describe('canViewClaim', () => {
    it('laisse l\'admin voir n\'importe quel dossier', () => {
        expect(canViewClaim({id: USER_ID, role: Role.ADMIN}, claim())).toBe(true);
    });

    describe('assuré', () => {
        const holder = {id: USER_ID, role: Role.POLICYHOLDER};

        it('voit le dossier qu\'il a déclaré', () => {
            expect(canViewClaim(holder, claim({declarantId: USER_ID}))).toBe(true);
        });

        it('ne voit pas le dossier d\'un autre', () => {
            expect(canViewClaim(holder, claim())).toBe(false);
        });

        it('ne confond pas son identifiant avec le type de filtre', () => {
            expect(canViewClaim(holder, claim({declarantId: 'declarant'}))).toBe(false);
        });
    });

    describe('gestionnaire', () => {
        const handler = {id: USER_ID, role: Role.HANDLER};

        it('voit le dossier qui lui est attribué', () => {
            expect(canViewClaim(handler, claim({handlerId: USER_ID}))).toBe(true);
        });

        it('voit la corbeille', () => {
            expect(canViewClaim(handler, claim({handlerId: null, status: ClaimStatus.DECLARED}))).toBe(true);
        });

        it('ne voit pas le dossier d\'un collègue', () => {
            expect(canViewClaim(handler, claim())).toBe(false);
        });

        it('ne voit pas un dossier déclaré déjà attribué à un collègue', () => {
            expect(canViewClaim(handler, claim({status: ClaimStatus.DECLARED}))).toBe(false);
        });

        it('ne voit pas un dossier sans gestionnaire sorti de la corbeille', () => {
            expect(canViewClaim(handler, claim({handlerId: null, status: ClaimStatus.CLOSED}))).toBe(false);
        });
    });

    describe('expert', () => {
        const expert = {id: USER_ID, role: Role.EXPERT};

        it('voit sa mission', () => {
            expect(canViewClaim(expert, claim({expertId: USER_ID}))).toBe(true);
        });

        it('ne voit pas la mission d\'un autre', () => {
            expect(canViewClaim(expert, claim())).toBe(false);
        });

        it('ne voit pas un dossier sans expert', () => {
            expect(canViewClaim(expert, claim({expertId: null}))).toBe(false);
        });
    });
});
