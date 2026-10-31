import {afterEach, describe, expect, it, vi} from "vitest";
import {fixedClock, systemClock} from "../../../src/shared/time/clock.js";

describe('systemClock', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renvoie l\'heure système', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-02T10:00:00.000Z'));

        expect(systemClock.now()).toEqual(new Date('2026-03-02T10:00:00.000Z'));
    });

    it('suit l\'écoulement du temps', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-02T10:00:00.000Z'));

        vi.advanceTimersByTime(1500);

        expect(systemClock.now()).toEqual(new Date('2026-03-02T10:00:01.500Z'));
    });
});

describe('fixedClock', () => {
    it('renvoie l\'instant demandé', () => {
        const clock = fixedClock('2026-03-02T10:00:00.000Z');

        expect(clock.now()).toEqual(new Date('2026-03-02T10:00:00.000Z'));
    });

    it('accepte un décalage horaire', () => {
        const clock = fixedClock('2026-03-02T11:00:00+01:00');

        expect(clock.now().toISOString()).toBe('2026-03-02T10:00:00.000Z');
    });

    it('ne suit pas le temps qui passe', () => {
        vi.useFakeTimers();
        const clock = fixedClock('2026-03-02T10:00:00.000Z');
        const before = clock.now();

        vi.advanceTimersByTime(60_000);

        expect(clock.now()).toEqual(before);
        vi.useRealTimers();
    });

    it('renvoie une nouvelle Date à chaque appel', () => {
        const clock = fixedClock('2026-03-02T10:00:00.000Z');

        expect(clock.now()).not.toBe(clock.now());
    });

    it('protège l\'horloge si le code appelant modifie la date reçue', () => {
        const clock = fixedClock('2026-03-02T10:00:00.000Z');

        clock.now().setUTCFullYear(1999);

        expect(clock.now().toISOString()).toBe('2026-03-02T10:00:00.000Z');
    });

    it('renvoie une date invalide pour une chaîne invalide', () => {
        expect(Number.isNaN(fixedClock('pas-une-date').now().getTime())).toBe(true);
    });
});
