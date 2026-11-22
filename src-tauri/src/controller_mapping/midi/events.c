#include <CoreMIDI/CoreMIDI.h>
#include <stdint.h>

typedef void (*PNDSMIDIReceive)(void *, uint8_t, uint8_t, uint8_t, uint8_t);

struct PNDSMIDIVisitor {
    void *context;
    PNDSMIDIReceive receive;
};

static void visit(void *context, MIDITimeStamp time, MIDIUniversalMessage message) {
    (void)time;
    if (message.type != kMIDIMessageTypeChannelVoice1)
        return;
    struct PNDSMIDIVisitor *visitor = context;
    switch (message.channelVoice1.status) {
    case kMIDICVStatusNoteOn:
    case kMIDICVStatusNoteOff:
        visitor->receive(visitor->context, message.channelVoice1.status,
                         message.channelVoice1.channel,
                         message.channelVoice1.note.number,
                         message.channelVoice1.note.velocity);
        break;
    case kMIDICVStatusControlChange:
        visitor->receive(visitor->context, message.channelVoice1.status,
                         message.channelVoice1.channel,
                         message.channelVoice1.controlChange.index,
                         message.channelVoice1.controlChange.data);
        break;
    default:
        break;
    }
}

void pnds_midi_visit(const MIDIEventList *list, void *context, PNDSMIDIReceive receive) {
    struct PNDSMIDIVisitor visitor = {context, receive};
    MIDIEventListForEachEvent(list, visit, &visitor);
}

#ifdef PNDS_MIDI_FIXTURE
#include <mach/mach_time.h>

OSStatus pnds_midi_send(MIDIEndpointRef source, uint8_t status, uint8_t channel,
                       uint8_t number, uint8_t value) {
    MIDIEventList events;
    uint32_t message = MIDI1UPChannelVoiceMessage(0, (MIDICVStatus)status, channel,
                                                number, value);
    MIDIEventPacket *packet = MIDIEventListInit(&events, kMIDIProtocol_1_0);
    MIDIEventListAdd(&events, sizeof(events), packet, mach_absolute_time(), 1,
                     &message);
    return MIDIReceivedEventList(source, &events);
}
#endif
