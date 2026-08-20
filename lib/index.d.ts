import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "tomilite";
export declare const inject: string[];
export interface Config {
    /** TomiLite API base URL. Default: local desktop app. */
    baseUrl: string;
    /** API token for non-localhost TomiLite instances (Settings → API Keys). */
    apiToken: string;
    /** Default project id used by TomiLite (single-user local: proj-default). */
    projectId: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
