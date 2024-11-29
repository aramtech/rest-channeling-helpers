import env from "$/server/env.js";
import { lock_method } from "$/server/utils/common/index.js";
import { description_suffix_regx, router_suffix_regx } from "$/server/utils/routers_helpers/matchers.js";
import cluster from "cluster";
import fs from "fs";
import path from "path";
import ts from "typescript";
import url from "url";

export type DescriptionProps = {
    fileUrl: string;
    event: string;
    rooms?: string[];
    description_text?: string;
    event_body_type_string: string;
    additionalTypes?: string;
    expected_response_body_type_string?: string;
    description_file_full_path?: string;
};

export const descriptions_map = {} as {
    [key: string]: DescriptionProps;
};


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
            if (options.event_body_type_string) {
                check_type(options.event_body_type_string);
            } else {
                options.event_body_type_string = "any";
            }

            if (options.expected_response_body_type_string) {
                check_type(options.expected_response_body_type_string);
            } else {
                options.expected_response_body_type_string = "never";
            }

            const route_path = url.fileURLToPath(options.fileUrl);
            const route_directory = path.dirname(route_path);

            const route_relative_path = url.fileURLToPath(options.fileUrl).replace(route_directory, "");
            const route_relative_directory = path.dirname(route_relative_path);

            const route_file_name = path.basename(route_path);

            const route_suffix_match = route_file_name.match(router_suffix_regx);
            if (!route_suffix_match) {
                console.error(
                    'Invalid Route Name, a Route file should end with "' + env.router.router_suffix + '" provided is: ',
                    route_file_name,
                );
                throw new Error();
            }

            const route_file_name_without_extension = route_file_name.slice(
                0,
                route_file_name.indexOf(route_suffix_match[0]),
            );

            console.log("Event on describe", options.event);

            const route_directory_content = fs.readdirSync(route_directory);
            const route_description_regx = RegExp(
                `${route_file_name_without_extension}${description_suffix_regx.toString().slice(1, -1)}`,
            );

            const description_file_name = route_directory_content.find((item) => {
                const item_stats = fs.statSync(path.join(route_directory, item));
                if (item_stats.isFile()) {
                    if (item.match(route_description_regx)) {
                        return true;
                    }
                }
                return false;
            });
            const description_file_full_path = !description_file_name
                ? path.join(
                      route_directory,
                      route_file_name_without_extension + env.router.description_pre_extension_suffix + ".md",
                  )
                : path.join(route_directory, description_file_name);
            const event_description_content = `<!-- --start--event-- ${options.event} -->

# Event Description 
${options.description_text || "No description Text Provided"}

## Event: 
${options.event}


${
    options.additionalTypes
        ? `## Defined Types: 
\`\`\`ts
${options.additionalTypes}
\`\`\``
        : ""
}



## Event Body type definition:
\`\`\`ts
type EventBody = ${options.event_body_type_string || "any"}
\`\`\`

${
    options.expected_response_body_type_string
        ? `
## Expected Response Content Type Definition: 
\`\`\`ts
type ExpectedResponseBody = ${options.expected_response_body_type_string || "any"}
\`\`\``
        : ""
}


<!-- --end--event-- ${options.event} -->`;

            if (!description_file_name) {
                fs.writeFileSync(description_file_full_path, event_description_content);
            } else {
                const content = fs.readFileSync(description_file_full_path, "utf-8");

                if (!content.includes(options.event)) {
                    fs.writeFileSync(description_file_full_path, content + "\n\n" + event_description_content);
                } else {
                    fs.writeFileSync(
                        description_file_full_path,
                        content.replace(
                            RegExp(
                                `\\<\\!-- --start--event-- ${options.event.replaceAll("/", "\\/")} --\\>(.|\n)*?\\<\\!-- --end--event-- ${options.event.replaceAll("/", "\\/")} --\\>`,
                            ),
                            event_description_content,
                        ),
                    );
                }
            }

            const route_precise_path =
                route_file_name_without_extension == "index"
                    ? route_relative_directory
                    : path.join(route_relative_directory, route_file_name_without_extension);


            options.description_file_full_path = path.join(route_precise_path, "/describe");

            if (descriptions_map[options.event]) {
                console.error(
                    "Event Descriptor Already Registered",
                    "\nNew Registration:",
                    options,
                    "\nOld Registration:",
                    descriptions_map[options.event],
                );
                throw new Error();
            }
            options.fileUrl = route_precise_path;
            descriptions_map[options.event] = options;
        } catch (error) {
            console.error(error);
            console.error("CRITICAL: Invalid Event Descriptor", options);
            process.exit(-1);
        }
    },
    {
        lock_name: "setting_up_event_descriptions",
    },
);
export const describeEvent = describe;
