// 📅 Calcul sur des DATES CALENDAIRES (sans heure). Convention : une date = minuit UTC.
// Ainsi "2026-03-02" est toujours le même objet, quel que soit le fuseau du serveur.

const DAY_MS = 24 * 60 * 60* 1000

/** Fuseau de référence du métier : les délais sont comptés en heure de Paris. */
export const BUSINESS_TIME_ZONE = 'Europe/Paris'

/** "2026-03-02" → Date à minuit UTC. */
export function parseDateOnly(isoDate:string):Date{
    return new Date(`${isoDate}T00:00:00.000Z`)
}

/** Date → "2026-03-02". */
export function formatDateOnly(date:Date):string{
    return date.toISOString().slice(0, 10)
}

/** Quel jour du calendrier est-il à `timeZone` à cet instant ? (ex. 23h30 UTC = lendemain à Paris) */
export function calendarDateIn(instant:Date, timezone:string = BUSINESS_TIME_ZONE):Date {
    // en-CA formate en "YYYY-MM-DD" : pratique pour reconstruire une date seule.
    const formated = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
    return parseDateOnly(formated);
}

/** Jour ouvré = du lundi au vendredi. Les jours fériés sont HORS PÉRIMÈTRE (voir l'énoncé). */
export function isBusinessDay(providedDate:Date):boolean {
    const day = providedDate.getUTCDay(); // 0 = dimanche, 6 = samedi
    return day !== 0 && day !== 6;
}

/** Ajoute `days` jours ouvrés à `start` (le jour de départ ne compte pas). */
export function addBusinessDays(start:Date, days: number): Date {
    let current = start.getTime()
    let remaining = days
    while (remaining > 0) {
        current += DAY_MS
        if(isBusinessDay(new Date(current))) remaining -=1;
    }
    return new Date(current)
}

export function  addDays(start:Date, days:number):Date {
    return new Date(start.getTime() + days * DAY_MS)
}

/** Nombre de jours ENTIERS écoulés entre deux instants. */
export function daysBetween(from:Date, to:Date):number {
    return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}