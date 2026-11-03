# v2 of every location plate: the same prompt plus an atmosphere sentence (interiors hazy toward the back, exteriors fog and beams).
import json
INT = ("A soft haze hangs in the air and builds with distance, faint in the foreground and heaviest in the background, "
       "fine chalk dust and airborne particles drifting and glinting wherever the light falls, every light source cutting soft visible shafts down through the haze.")
EXT = ("Low fog rolls across the ground and a thick haze fills the night air, deepening with distance until the background dissolves into it, "
       "every lamp and lit window throwing visible beams and wide glowing halos through the fog, moisture and dust drifting in the beams.")
FILES = {
    'gym': ('plate-gym-v1.txt', INT), 'gym-wide': ('plate-gym-v2-wide.txt', INT), 'locker-room': ('plate-locker-room-v1.txt', INT),
    'coach-office': ('plate-coach-office-v1.txt', INT), 'dorm-hallway': ('plate-dorm-hallway-v1.txt', INT),
    'president-office': ('plate-president-office-v1.txt', INT),
    'parking-lot': ('plate-parking-lot-v1.txt', EXT), 'roof': ('plate-roof-v1.txt', EXT),
}
out = {}
for name, (src, atm) in FILES.items():
    t = ' '.join(open(src, encoding='utf-8').read().split())
    i = t.index('Captured with a wide-latitude')
    t = t[:i] + atm + ' ' + t[i:]
    open(f'plate-{name}-atmos.txt', 'w', encoding='utf-8').write(t + '\n')
    out[name] = t
print({k: len(v) for k, v in out.items()})
