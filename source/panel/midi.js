// Web MIDI plumbing. The panel is an extension page, so the permission
// grant is per-extension-origin and persists in the kiosk profile — grant
// it once while building the template profile.
//
// onDevices(count) reports how many inputs are connected, on every change,
// so the panel can keep its ⊙ learn buttons out of sight until there is
// something to learn from (design review finding 10). It is never called
// when Web MIDI is unavailable or refused: the panel's default is "none".

export async function initMIDI({ onCC, onStatus, onDevices = () => {} }) {
  if (!navigator.requestMIDIAccess) {
    onStatus('Web MIDI unavailable');
    return;
  }
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    onStatus('MIDI permission denied');
    return;
  }

  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name);
      input.onmidimessage = (msg) => {
        const [status, data1, data2] = msg.data;
        if ((status & 0xf0) === 0xb0) onCC(data1, data2); // control change
      };
    }
    onStatus(names.length ? names.join(', ') : 'no device');
    onDevices(names.length);
  };

  access.onstatechange = attach;
  attach();
}
