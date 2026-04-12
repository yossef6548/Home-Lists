import { EventEmitter } from "events";

export const eventEmitter = new EventEmitter();

export function broadcastUpdate() {
  eventEmitter.emit("update");
}
