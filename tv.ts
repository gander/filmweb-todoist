import scrapeIt from 'scrape-it';

interface BroadcastsData {
    [date: string]: {
        [id: string]: {
            details: {
                name: string;
            };
            seances: {
                [index: string]: {
                    time: string;
                };
            };
        };
    };
}

interface Emission {
    date: string;
    where: {
        tv: string;
        at: string[];
    }[];
}

export default async function (url: string): Promise<string[]> {


    const {data} = await scrapeIt(
        `${url}/tv`,
        {
            broadcastsData: {
                selector: 'script[data-source="broadcastsData"]',
                convert: (x) => JSON.parse(x),
            },
        },
    );

    const {broadcastsData: bd} = data as { broadcastsData: BroadcastsData };

    const set = new Set();

    Object.entries(bd).map(
        ([date, entries]): Emission => ({
            date,
            where: Object.values(entries).map(({details, seances}) => ({
                tv: details.name,
                at: Object.values(seances).map(({time}) => time),
            })),
        }),
    ).forEach(({date, where}) =>
        where.forEach(({tv, at}) => set.add(`${date}: ${at.join(',')} @ ${tv}`)),
    );

    return Array.from(set) as string[];
}
