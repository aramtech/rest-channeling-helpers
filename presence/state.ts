import client from "$/server/modules/index.js";
import { io } from "$/server/utils/channels_builder/index.js";
import make_threaded_json from "$/server/utils/dynamic_json/threaded_json.js";
import { BroadcastOperator, Server } from "socket.io";
export type UserInfo = {
    user_id: number;
    username: string;
    user_type: string;
    email: string | undefined | null;
    phone: string | undefined | null;
    full_name: string;
};

export type UserSocketDetails = {
    user: UserInfo;
    socket_ids: string[];
};

type UsersData = Record<string, UserSocketDetails>;

export type RoomData = {
    call_current_users: {
        user_id: number;
        socket_id: string;
    }[];
    call_type: null | "video" | "voice";
    call_id: null | string;
    users_joined_call: number | null;
    users_rejected_call: number | null;
    count_of_notified_users_when_call_started: number | null;
};
type RoomsData = Record<number, RoomData>;

const initial_users_sockets_state = {
    data: {} as UsersData,
    rooms: {} as RoomsData,
};

const users_sockets_state = await make_threaded_json(initial_users_sockets_state, {
    lazy: true,
    unique_event_number: "customers_socket_state",
    broadcast_on_update: false,
});

export const select_user_presence = async (
    id: number,
    data: UsersData | undefined = undefined,
): Promise<UserSocketDetails | undefined> => {
    if (!data) {
        return await users_sockets_state.get(["data", id.toString()]);
    } else {
        return data[id];
    }
};
export const get_users_data = async (): Promise<UsersData> => {
    return await users_sockets_state.get(["data"]);
};

export const get_room_socket_ids = async (
    room_id: number,
    options?: {
        exclude_user_ids?: number[];
    },
) => {
    const room = await client.messaging_rooms.findFirst({
        where: {
            deleted: false,
            room_id: Number(room_id),
        },
        select: {
            members: {
                select: {
                    user_id: true,
                },
                where: {
                    deleted: false,
                    user: {
                        active: true,
                        deleted: false,
                    },
                },
            },
        },
    });
    const socket_ids = [] as string[];
    if (room?.members?.length) {
        const users_presence_info = await get_users_data();
        for (const member of room.members) {
            if (member.user_id) {
                if (options?.exclude_user_ids?.find((u_id) => u_id == member.user_id)) {
                    continue;
                }
                const user_socket_data = users_presence_info[member.user_id];
                if (user_socket_data?.socket_ids?.length) {
                    socket_ids.push(...user_socket_data.socket_ids);
                }
            }
        }
    }
    return socket_ids;
};

export const join_call = async (room_id: number, user_id: number, socket_id: string) => {
    const room_data = await get_room_data(room_id);
    if (room_data?.call_current_users?.length) {
        const found_user = room_data.call_current_users.find((f) => {
            return f.user_id == user_id;
        });
        if (!found_user) {
            await users_sockets_state.push(["rooms", String(room_id), "call_current_users"], {
                user_id: user_id,
                socket_id: socket_id,
            });
            await users_sockets_state.set(
                ["rooms", String(room_id)],
                "users_joined_call",
                Number(room_data.users_joined_call) + 1,
            );
            return {
                new_join: true,
            };
        }
    }
    return null;
};

export const leave_call = async (room_id: number, socket_id: string) => {
    const room_data = await get_room_data(room_id);
    if (room_data?.call_current_users.length) {
        const found_user = room_data.call_current_users.find((u) => u.socket_id == socket_id);
        if (found_user) {
            await users_sockets_state.remove_item_from_array(
                ["rooms", String(room_id), "call_current_users"],
                found_user,
                "socket_id",
            );
            const call_ended = room_data.call_current_users.length <= 2;
            return {
                call_ended,
                call_type: room_data.call_type,
                call_id: room_data.call_id,
                user_id: found_user.user_id,
                socket_id: found_user.socket_id,
            };
        }
    }
    return null;
};

export const get_user_data = select_user_presence;

export const send_event_to_user = async (options: {
    user_id: number;
    event: string;
    message: any;
    cb?: (err: any, response: any) => any;
    timeout?: number;
}) => {
    const user_presence = await select_user_presence(options.user_id);
    if (user_presence?.socket_ids?.length) {
        if (io) {
            let query: BroadcastOperator<any, any> | Server<any, any, any, any>;
            if (options.timeout && options.cb) {
                query = io.timeout(options.timeout);
            } else {
                query = io;
            }
            if (options.cb) {
                query.to(user_presence.socket_ids).emit(options.event, options.message, options.cb);
            } else {
                query.to(user_presence.socket_ids).emit(options.event, options.message);
            }
            return true;
        }
    }
    return false;
};

export const get_room_data = async (room_id: number) => {
    const room: RoomData | undefined = await users_sockets_state.get(["rooms", String(room_id)]);
    return room;
};

export const get_rooms_data = async () => {
    const result: RoomsData = await users_sockets_state.get("rooms");
    return result;
};

export const start_call_killer = async (socket_id: string) => {
    try {
        const user_ongoing_calls = await get_socket_ongoing_calls(socket_id);
        if (user_ongoing_calls.length) {
            for (const room_id of user_ongoing_calls) {
                await leave_call(Number(room_id), socket_id);
            }
        }
    } catch (error) {
        console.log(error);
    }
};
export const get_socket_ongoing_calls = async (socket_id: string) => {
    const rooms = await get_rooms_data();
    const ongoing_calls = [] as number[];
    for (const room_id in rooms) {
        if (rooms[room_id]?.call_current_users?.find((u) => socket_id == u.socket_id)) {
            ongoing_calls.push(Number(room_id));
        }
    }
    return ongoing_calls;
};

export const add_user_presence_details = async (user: UserInfo, socket_id: string) => {
    const old_presence_info = await select_user_presence(user.user_id);
    if (old_presence_info) {
        await users_sockets_state.push(["data", user.user_id.toString(), "socket_ids"], socket_id);
    } else {
        await users_sockets_state.set("data", user.user_id.toString(), {
            user: user,
            socket_ids: [socket_id],
        } as UserSocketDetails);
    }
};

export const remove_user_presence_details = async (user: UserInfo, socket_id: string) => {
    const old_presence_info = await select_user_presence(user.user_id);
    if (old_presence_info) {
        await users_sockets_state.remove_item_from_array(["data", user.user_id.toString(), "socket_ids"], socket_id);
    }
};

export default users_sockets_state;
export { users_sockets_state };
