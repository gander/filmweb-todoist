import {TodoistApi} from '@doist/todoist-api-typescript';
import scrapeIt, {ScrapeResult} from 'scrape-it';
import cliProgress from 'cli-progress'
import 'dotenv/config';
import tv from './tv';

const api = new TodoistApi(process.env.TODOIST_TOKEN as string);
const regex = new RegExp(`\\((?<url>https://www.filmweb.pl/[^)]+)\\)$`, 'm');

const projectId = parseInt(process.env.TODOIST_PROJECT as string);
const scrapeOpts = {
    vods: {
        listItem: 'li.filmVodSection__item',
        data: {
            type: '.filmVodSection__badge',
            provider: {
                selector: 'h3',
                attr: 'title',
            },
        },
    },
};
const excludedLabels = (process.env.TODOIST_LABELS_EXCLUDED as string).split(',');

class LabelsService {
    private api: TodoistApi;
    private map: Map<string, number>;

    constructor(api: TodoistApi) {
        this.api = api;
        this.map = new Map<string, number>();
    }

    async load() {
        (await this.api.getLabels())
            .filter(({name}) => name.startsWith('VOD.'))
            .forEach(({id, name}) => this.map.set(name, id));
    }

    async getLabelIds(lbls: string[]): Promise<number[]> {
        return Promise.all(lbls.map(async (lbl): Promise<number> => await this.getLabelId(lbl)));
    }

    async getLabelId(lbl: string): Promise<number> {
        if (this.map.has(lbl)) {
            return this.map.get(lbl) as number;
        }

        const {id} = await this.api.addLabel({name: lbl})

        return id;
    }

}

interface Vods {
    vods: Vod[];
}

interface Vod {
    type: string,
    provider: string
}

interface Task {
    id: number,
    labels: number[],
    url: string,
}

const urls = new Set();
const promises: Promise<boolean>[] = [];

const bar = new cliProgress.SingleBar({}, cliProgress.Presets.rect);

const getTasks = async (): Promise<Task[]> =>
    (await api.getTasks({projectId}))
        .map(task => ({
            id: task.id,
            labels: task.labelIds,
            url: regex.exec(task.content)?.groups?.url,
        }))
        .filter((taskUrl: Task | { url: undefined }): taskUrl is Task => !!taskUrl.url)
        .filter((task: Task) => {
            const exists = urls.has(task.url);

            if (exists) {
                promises.push(api.closeTask(task.id));
            } else {
                urls.add(task.url);
            }

            return !exists;
        });


const getEntryLabels = async (url: string): Promise<string[]> => {
    return (await scrapeIt(`${url}/vod`, scrapeOpts) as ScrapeResult<Vods>)
        .data.vods
        .filter(vod => vod.type === 'abonament')
        .map(({provider}) => provider)
        .map(value => value.replace(/\W/g, ''))
        .map(value => value.toUpperCase())
        .filter(value => !excludedLabels.includes(value))
        .map(value => `VOD.${value}`);
};

async function main() {
    const labels = new LabelsService(api);
    await labels.load();

    const todoTasks = await getTasks();

    console.log('Removed duplicates:', (await Promise.all(promises)).length);

    const log = [];

    bar.start(todoTasks.length, 0);
    for (let todoTask of todoTasks) {
        const lbls = await getEntryLabels(todoTask.url);
        const ids = await labels.getLabelIds(lbls);
        const tvs = await tv(todoTask.url);
        tvs.unshift(...lbls);
        await api.updateTask(todoTask.id, {labelIds: ids, description: tvs.join("; \n")});
        if (lbls.length) {
            log.push([todoTask.id, todoTask.url, lbls.join("; ")]);
        }
        bar.increment();
    }
    bar.stop();

    console.table(log);
}

main().catch(e => console.error(e.message));
