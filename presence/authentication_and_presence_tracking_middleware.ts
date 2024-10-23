import { Socket } from "socket.io";
import { AuthenticatedUser, use_token_in_socket_to_get_user } from "../../../middlewares/user.middleware.js";
import { client } from "../../../modules/index.js";
import {
    add_user_presence_details,
    remove_user_presence_details,
    select_user_presence,
    start_call_killer,
} from "./state.js";


import logger from "$/server/utils/log/index.js";

const log = await logger("user presence tracker", "green", true, "Info")

type SocketInstance = Socket<any, any, any, any>;

const is_middleware_rejected = (middleware_result: any) => {
    return middleware_result === false || typeof middleware_result == "string";
};

const extract_scope = (socket: SocketInstance) => {
    const scope: string | undefined = socket.handshake.auth?.["x-app"] || socket.handshake.auth?.["x-scope"];
    return scope;
};

const validate_scope_parameter = (scope: string | undefined, required_scope: string) => {
    if (scope != required_scope) {
        if (scope) {
            return "region Access 'x-app' parameter is not for this section of the api";
        } else {
            return "region Access 'x-app' parameter is not provided in auth data";
        }
    }
};

const authenticate_socket = async (socket: SocketInstance) => {
    try {
        const user = await use_token_in_socket_to_get_user(socket);
        if (user) {
            socket.data.user = user;
        } else {
            return "user not found";
        }
    } catch (error: any) {
        log(error);
        return error.error.msg || error.msg || error.message || "unauthenticated user";
    }
};

const register_presence = async (socket: SocketInstance) => {
    try {
        const _user = {...socket.data.user as AuthenticatedUser};
        const user = {
            ..._user, 
            username: ((_user as any).user_name || (_user as any).username ) as string,
            user_name: ((_user as any).user_name || (_user as any).username ) as string,
            name: ((_user as any).name || (_user as any).full_name ) as string,
            full_name: ((_user as any).name || (_user as any).full_name ) as string,
            user_type: (_user as any).role || (_user as any).user_type,
            role: (_user as any).role || (_user as any).user_type,
            
        }
       
        const user_current_presence = await select_user_presence(user.user_id);
        if (
            !user_current_presence?.socket_ids.find((sid) => {
                sid == socket.id;
            })
        ) {
            const connect_time = new Date();
            const was_offline = !user_current_presence?.socket_ids?.length;



            if (was_offline) {
                await client.users.update({
                    where: {
                        user_id: socket.data.user.user_id,
                    },
                    data: {
                        // @ts-ignore
                        last_online: connect_time,
                    },
                });
            }

            await add_user_presence_details(
                {
                    user_id: user.user_id,
                    username: (user as any).user_name || (user as any).username,
                    user_type: (user as any).role || (user as any).user_type,
                    email: user.email,
                    phone: user.phone,
                    full_name: (user as any).name || (user as any).full_name,
                },
                socket.id,
            );

            socket.to("user-presence").emit("user-presence:connected", {
                socket_id: socket.id,
                user_id: user.user_id,
                was_offline,
                current_connected_socket: user_current_presence?.socket_ids || [],
                connect_time: connect_time,
                username: (user as any).user_name || (user as any).username,
                user_type: (user as any).role ||(user as any).user_type,
                email: user.email,
                phone: user.phone,
                    full_name: (user as any).name || (user as any).full_name,
            });
            socket
                .to(`user-presence:${user.user_id}`)
                .emit(`user-presence:${user.user_id}:connected`, await select_user_presence(user.user_id));

            socket.join(`user:${user.user_id}`);
            log("connected", { username: (user as any).user_name || (user as any).username, user_id: user.user_id, socket_id: socket.id, was_offline });

            socket.on("disconnect", async () => {
                await remove_user_presence_details(user, socket.id);
                const current_user_presence = await select_user_presence(user.user_id);
                const disconnect_time = new Date();
                const still_online = !!current_user_presence?.socket_ids.length;
                if (!still_online) {
                    await client.users.update({
                        where: {
                            user_id: socket.data.user.user_id,
                        },
                        data: {
                            // @ts-ignore
                            last_offline: disconnect_time,
                        },
                    });
                }

                start_call_killer(socket.id);

                socket.to("user-presence").emit("user-presence:disconnected", {
                    socket_id: socket.id,
                    still_online,
                    disconnect_time,
                    user_id: user.user_id,
                    current_connected_sockets: current_user_presence?.socket_ids || [],
                });
                socket.to(`user-presence:${user.user_id}`).emit(`user-presence:${user.user_id}:disconnected`, {
                    socket_id: socket.id,
                    still_online,
                    disconnect_time,
                    user_id: user.user_id,
                    current_connected_sockets: current_user_presence?.socket_ids || [],
                });

                log("disconnected", { username: user.username, user_id: user.user_id, socket_id: socket.id, still_online });
            });
        }
    } catch (error) {
        log(error);
        return false;
    }
};

export const create_scoping_and_presence_tracking_channels_middleware = (props: {
    required_scope: string | undefined;
}) => {
    return async (socket: SocketInstance) => {
        const scope = extract_scope(socket);

        if (props.required_scope) {
            const result = validate_scope_parameter(scope, props.required_scope);
            if (is_middleware_rejected(result)) {
                log.warning("socket scope is not valid", result)
                return result;
            }
        }
        
        const authentication_result = await authenticate_socket(socket);
        if (is_middleware_rejected(authentication_result)) {
            log.warning("socket failed to authenticate", authentication_result)
            return authentication_result;
        }

        const registration_result = await register_presence(socket);
        log.warning(registration_result === false ? "presence registration failed" : "presence registered" , "for socket", socket.data.user?.username)
        return registration_result;
    };
};
