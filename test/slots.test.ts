import {Slots} from "../src/slots";
import {QuorumSet} from "@stellarbeat/js-stellarbeat-shared";
import {pino} from "pino";
import {Slot} from "../src/slot";
import {mock} from "jest-mock-extended";

describe('slots', () => {
    describe('getSlot', () => {
        const qSet = new QuorumSet(2, ['A', 'B']);
        const logger = mock(pino())
        const slots = new Slots(qSet,logger)
        it('should create new slot', () => {
           const slot = slots.getSlot(BigInt(1));
           expect(slot).toBeInstanceOf(Slot);
        })

        it('should return same slot', () => {
            const slot = slots.getSlot(BigInt(1));
            slot.addExternalizeValue('A', '1');
            slot.addExternalizeValue('B', '1');
            expect(slot.closed()).toBeTruthy();

            const fetchedSlot = slots.getSlot(BigInt(1));
            expect(fetchedSlot.closed()).toBeTruthy();
        })

        it('should return different slot', () => {
            const slot = slots.getSlot(BigInt(1));
            slot.addExternalizeValue('A', '1');
            slot.addExternalizeValue('B', '1');
            expect(slot.closed()).toBeTruthy();

            const fetchedSlot = slots.getSlot(BigInt(2));
            expect(fetchedSlot.closed()).toBeFalsy();
        });
    })
})