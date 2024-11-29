const env = (await import("$/server/env.js")).env

export const directory_alias_suffix_regx = RegExp(env.channels.alias_suffix_regx || "\\.directory_alias\\.js$");
export const channels_suffix_regx = RegExp(env.channels.channel_suffix_regx || "\\.channel\\.js$");
export const description_suffix_regx = RegExp(env.channels.description_suffix_regx || "\\.description\\.[a-zA-Z]{1,10}$");
export const middleware_suffix_regx = RegExp(env.channels.middleware_suffix_regx || "\\.middleware\\.(?:js|ts)$");
