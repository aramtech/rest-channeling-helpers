import root_paths from "$/server/dynamic_configuration/root_paths.js";
import env from "$/server/env.js";
import { AuthorizationOption } from "$/server/middlewares/authorize.middleware.js";
import { lock_method } from "$/server/utils/common/index.js";
import { router_suffix_regx as channels_suffix_regx, description_suffix_regx } from "$/server/utils/routers_helpers/matchers.js";
import cluster from "cluster";
import fs from "fs";
import path from "path";
import ts from "typescript";
import url from "url";

export type DescriptionProps = {
    fileUrl: string;
    path?: string;
    full_channel_path?: string;
    requires_auth?: boolean;
    requires_authorities?: {
        allow?: AuthorizationOption;
        reject?: AuthorizationOption;
    };
    description_text?: string;
    request_body_type_string?: string;
    additionalTypes?: string;
    response_body_type_string?: string;
    description_file_full_path?: string;
};
export const descriptions_map = {} as {
    [key: string]: DescriptionProps;
};
const channels_directory = path.join(root_paths.src_path, env.router.router_directory);

const check_type = (type_string: string) => {
    const sourceCode = `type TempType = ${type_string};`;
    eval(ts.transpile(sourceCode));
};

export const describe = lock_method(
    (options: DescriptionProps) => {
        if (!cluster.isPrimary || env.build_runtime) {
            return;
        }
        try {
            if (options.request_body_type_string) {
                check_type(options.request_body_type_string);
            } else {
                options.request_body_type_string = "any";
            }



            if (options.response_body_type_string) {
                check_type(options.response_body_type_string);
            } else {
                options.response_body_type_string = "any";
            }

            if (!options.path) {
                options.path = "/";
            }

            const channel_path = url.fileURLToPath(options.fileUrl);
            const channel_directory = path.dirname(channel_path);

            const channel_relative_path = url.fileURLToPath(options.fileUrl).replace(channels_directory, "");
            const channel_relative_directory = path.dirname(channel_relative_path);

            const channel_file_name = path.basename(channel_path);
            const channel_suffix_match = channel_file_name.match(channels_suffix_regx);
            if (!channel_suffix_match) {
                console.error(
                    'Invalid Channel Name, a channel file should end with "' + env.router.router_suffix + '" provided is: ',
                    channel_file_name,
                );
                throw new Error();
            }

            const channel_file_name_without_extension = channel_file_name.slice(
                0,
                channel_file_name.indexOf(channel_suffix_match[0]),
            );

            const channel_precise_path = path.join(
                channel_file_name_without_extension == "index"
                    ? channel_relative_directory
                    : path.join(channel_relative_directory, channel_file_name_without_extension),
                options.path || "",
            );
            console.log("Channel Full path on describe", channel_precise_path);

            const channel_directory_content = fs.readdirSync(channel_directory);
            const channel_description_regx = RegExp(
                `${channel_file_name_without_extension}${description_suffix_regx.toString().slice(1, -1)}`,
            );

            const description_file_name = channel_directory_content.find((item) => {
                const item_stats = fs.statSync(path.join(channel_directory, item));
                if (item_stats.isFile()) {
                    if (item.match(channel_description_regx)) {
                        return true;
                    }
                }
                return false;
            });
            const description_file_full_path = !description_file_name
                ? path.join(
                      channel_directory,
                      channel_file_name_without_extension + env.router.description_pre_extension_suffix + ".md",
                  )
                : path.join(channel_directory, description_file_name);
            const channel_description_content = `<!-- --start--channel-- ${channel_precise_path} -->

# Channel Description 
${options.description_text || "No description Text Provided"}

## Channel Path: 
${channel_precise_path}


${
    options.additionalTypes
        ? `## Defined Types: 
\`\`\`ts
${options.additionalTypes}
\`\`\``
        : ""
}



## Channel Request Body type definition:
\`\`\`ts
type RequestBody = ${options.request_body_type_string || "any"}
\`\`\`

## Response Content Type Definition: 
\`\`\`ts
type Response = ${options.response_body_type_string || "any"}
\`\`\`


<!-- --end--channel-- ${channel_precise_path} -->`;

            if (!description_file_name) {
                fs.writeFileSync(description_file_full_path, channel_description_content);
            } else {
                const content = fs.readFileSync(description_file_full_path, "utf-8");

                if (!content.includes(channel_precise_path)) {
                    fs.writeFileSync(description_file_full_path, content + "\n\n" + channel_description_content);
                } else {
                    fs.writeFileSync(
                        description_file_full_path,
                        content.replace(
                            RegExp(
                                `\\<\\!-- --start--channel-- ${channel_precise_path.replaceAll("/", "\\/")} --\\>(.|\n)*?\\<\\!-- --end--channel-- ${channel_precise_path.replaceAll("/", "\\/")} --\\>`,
                            ),
                            channel_description_content,
                        ),
                    );
                }
            }

            options.full_channel_path = channel_precise_path;
            options.description_file_full_path = path.join(channel_precise_path, "/describe");

            if (descriptions_map[options.full_channel_path]) {
                console.error(
                    "Channel Descriptor Already Registered",
                    "\nNew Registration:",
                    options,
                    "\nOld Registration:",
                    descriptions_map[options.full_channel_path],
                );
                throw new Error();
            }
            options.fileUrl = options.full_channel_path;
            descriptions_map[options.full_channel_path] = options;
        } catch (error) {
            console.error(error);
            console.error("CRITICAL: Invalid Channel Descriptor", options);
            process.exit(-1);
        }
    },
    {
        lock_name: "setting_up_channel_descriptions",
    },
);
export const describeChannel = describe