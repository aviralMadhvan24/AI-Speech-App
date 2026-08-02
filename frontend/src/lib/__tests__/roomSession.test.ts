import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRoomSession,
  readRoomSession,
  saveRoomSession,
  type BattleRoomSession,
  type DebateRoomSession,
} from "../roomSession";

describe("roomSession store", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("save/read/clear round-trips per feature + code", () => {
    it("round-trips a debate participant identity", () => {
      const value: DebateRoomSession = { participantId: "p-123", savedAt: 111 };
      saveRoomSession("debate", "ABC234", value);
      expect(readRoomSession("debate", "ABC234")).toEqual(value);

      clearRoomSession("debate", "ABC234");
      expect(readRoomSession("debate", "ABC234")).toBeNull();
    });

    it("round-trips a GD participant identity", () => {
      const value: DebateRoomSession = { participantId: "gd-9", savedAt: 222 };
      saveRoomSession("gd", "XYZ789", value);
      expect(readRoomSession("gd", "XYZ789")).toEqual(value);

      clearRoomSession("gd", "XYZ789");
      expect(readRoomSession("gd", "XYZ789")).toBeNull();
    });

    it("round-trips a battle player identity", () => {
      const value: BattleRoomSession = {
        playerId: "player-1",
        role: "host",
        savedAt: 333,
      };
      saveRoomSession("battle", "BTL001", value);
      expect(readRoomSession("battle", "BTL001")).toEqual(value);

      clearRoomSession("battle", "BTL001");
      expect(readRoomSession("battle", "BTL001")).toBeNull();
    });
  });

  describe("key namespacing", () => {
    it("keeps features and codes isolated from one another", () => {
      saveRoomSession("debate", "ROOM1", { participantId: "d1", savedAt: 1 });
      saveRoomSession("gd", "ROOM1", { participantId: "g1", savedAt: 2 });
      saveRoomSession("battle", "ROOM1", {
        playerId: "b1",
        role: "opponent",
        savedAt: 3,
      });
      saveRoomSession("debate", "ROOM2", { participantId: "d2", savedAt: 4 });

      expect(readRoomSession("debate", "ROOM1")).toEqual({
        participantId: "d1",
        savedAt: 1,
      });
      expect(readRoomSession("gd", "ROOM1")).toEqual({
        participantId: "g1",
        savedAt: 2,
      });
      expect(readRoomSession("battle", "ROOM1")).toEqual({
        playerId: "b1",
        role: "opponent",
        savedAt: 3,
      });
      expect(readRoomSession("debate", "ROOM2")).toEqual({
        participantId: "d2",
        savedAt: 4,
      });
    });

    it("uses a namespaced, uppercased storage key", () => {
      saveRoomSession("debate", "abc234", { participantId: "p", savedAt: 5 });
      // Key is normalized to uppercase and namespaced under spa.room.<feature>.
      expect(window.sessionStorage.getItem("spa.room.debate.ABC234")).not.toBeNull();
      expect(window.sessionStorage.getItem("spa.room.debate.abc234")).toBeNull();
    });

    it("normalizes code casing so reads match saves regardless of case", () => {
      saveRoomSession("debate", "abc234", { participantId: "p", savedAt: 6 });
      expect(readRoomSession("debate", "ABC234")).toEqual({
        participantId: "p",
        savedAt: 6,
      });
      expect(readRoomSession("debate", "AbC234")).toEqual({
        participantId: "p",
        savedAt: 6,
      });

      clearRoomSession("debate", "ABC234");
      expect(readRoomSession("debate", "abc234")).toBeNull();
    });
  });

  describe("missing key", () => {
    it("returns null when nothing was ever stored", () => {
      expect(readRoomSession("debate", "NOPE01")).toBeNull();
      expect(readRoomSession("gd", "NOPE01")).toBeNull();
      expect(readRoomSession("battle", "NOPE01")).toBeNull();
    });
  });

  describe("corrupt JSON tolerance", () => {
    it("returns null when the stored value is not valid JSON", () => {
      window.sessionStorage.setItem("spa.room.debate.BAD001", "{not json");
      expect(readRoomSession("debate", "BAD001")).toBeNull();
    });

    it("returns null when the stored value is a JSON primitive, not an object", () => {
      window.sessionStorage.setItem("spa.room.battle.BAD002", "42");
      expect(readRoomSession("battle", "BAD002")).toBeNull();

      window.sessionStorage.setItem("spa.room.battle.BAD003", "null");
      expect(readRoomSession("battle", "BAD003")).toBeNull();
    });
  });
});
