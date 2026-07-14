export const ROLES = {
  werewolf: {
    id: 'werewolf',
    name: 'Werewolf',
    plural: 'Werewolves',
    team: 'wolf',
    image: 'assets/werewolf.webp',
    sigil: '🐺',
    rule: 'Wake with the pack each night and agree on one victim. By day, hide among the village.',
    wake: 'The Werewolves wake, recognise one another, and choose a victim.'
  },
  villager: {
    id: 'villager',
    name: 'Villager',
    plural: 'Villagers',
    team: 'village',
    image: 'assets/villager.webp',
    sigil: '🏠',
    rule: 'You have no night power. Read the room, expose the pack, and keep the village alive.'
  },
  seer: {
    id: 'seer',
    name: 'Seer',
    team: 'village',
    image: 'assets/seer.webp',
    sigil: '✦',
    rule: 'Each night, secretly reveal the true role of one living player.',
    wake: 'The Seer wakes and chooses one soul whose true identity will be revealed.'
  },
  witch: {
    id: 'witch',
    name: 'Witch',
    team: 'village',
    image: 'assets/witch.webp',
    sigil: '⚗',
    rule: 'You have one healing potion and one poison. Each may be used once during the entire game.',
    wake: 'The Witch wakes. Reveal tonight’s victim and offer the two potions.'
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    team: 'village',
    image: 'assets/hunter.webp',
    sigil: '⌖',
    rule: 'When you die for any reason, choose one other living player to fall with your final shot.'
  },
  cupid: {
    id: 'cupid',
    name: 'Cupid',
    team: 'village',
    image: 'assets/cupid.webp',
    sigil: '♥',
    rule: 'On the first night, bind any two players as lovers. You may choose yourself.'
  },
  'little-girl': {
    id: 'little-girl',
    name: 'Little Girl',
    team: 'village',
    image: 'assets/little-girl.webp',
    sigil: '◉',
    rule: 'You may physically peek while the Werewolves are awake. If caught, you die in place of their victim.'
  },
  thief: {
    id: 'thief',
    name: 'Thief',
    team: 'village',
    image: 'assets/thief.webp',
    sigil: '⚿',
    rule: 'On the first night, inspect the two spare cards and optionally exchange your role for one of them.'
  },
  sheriff: {
    id: 'sheriff',
    name: 'Sheriff',
    team: 'office',
    image: 'assets/sheriff.webp',
    sigil: '✹',
    rule: 'The elected Sheriff’s village vote counts twice. On death, the Sheriff names a successor.'
  },
  storyteller: {
    id: 'storyteller',
    name: 'Storyteller',
    team: 'story',
    image: 'assets/storyteller.webp',
    sigil: '☾',
    rule: 'Guide the village through every secret awakening. You do not hold a character role or vote.'
  }
};

export const SPECIAL_ROLE_IDS = ['seer', 'witch', 'hunter', 'cupid', 'little-girl', 'thief'];

export const PRESETS = {
  first: {
    name: 'First Moon',
    description: 'The official learning mix: Seer, Werewolves and Villagers.',
    roles: ['seer'],
    sheriff: false
  },
  classic: {
    name: 'Classic Night',
    description: 'A rich, balanced village with the four best-known special roles.',
    roles: ['seer', 'witch', 'hunter', 'cupid'],
    sheriff: true
  },
  full: {
    name: 'Full Moon',
    description: 'The complete original collection, including Thief and Little Girl.',
    roles: ['seer', 'witch', 'hunter', 'cupid', 'little-girl', 'thief'],
    sheriff: true
  }
};

export const PHASE_META = {
  lobby: ['The village gathers', 'Invite everyone before the moon rises.'],
  'role-reveal': ['The cards are dealt', 'Your fate waits face-down.'],
  'setup-thief': ['The Thief wakes', 'Two unclaimed destinies wait in the dark.'],
  'setup-cupid': ['Cupid wakes', 'Two hearts will be bound until death.'],
  'setup-lovers': ['The arrow has flown', 'Only two hearts are bound.'],
  'night-seer': ['The Seer wakes', 'One true identity may be revealed.'],
  'night-wolves': ['The pack wakes', 'The hunt must agree on one victim.'],
  'night-witch': ['The Witch wakes', 'Tonight’s fate may still be rewritten.'],
  resolution: ['Fate is turning', 'Ancient bonds claim their due.'],
  dawn: ['Dawn breaks', 'The village discovers what the night has taken.'],
  'sheriff-vote': ['Elect the Sheriff', 'One voice will carry the weight of two.'],
  'day-discussion': ['The village debates', 'Truth and lies wear the same face.'],
  'day-vote': ['Cast your judgement', 'The ballot seals when the last vote falls.'],
  'day-result': ['Judgement falls', 'Night draws closer.'],
  'game-over': ['The tale is ended', 'The final cards have been revealed.']
};

export const STORY_CUES = {
  'role-reveal': 'The cards have been dealt. Each player may now learn their secret fate.',
  'setup-thief': 'The Thief wakes, looks upon the two cards left untouched, and may exchange their destiny.',
  'setup-cupid': 'Cupid wakes and chooses two souls to bind together in love.',
  'setup-lovers': 'Everyone, open your eyes. Cupid’s arrow has flown. Turn over the card before you to learn whether your heart is still your own.',
  'night-seer': 'The Seer wakes and chooses one player whose true identity they wish to know.',
  'night-wolves': 'The Werewolves wake, recognise one another, and silently choose a victim.',
  'night-witch': 'The Witch wakes. Here is the victim chosen by the pack. Will fate be changed?',
  dawn: 'The sun rises. Everyone wakes… everyone, perhaps, except those claimed in the night.',
  'sheriff-vote': 'The village will now elect a Sheriff. Their vote will carry the weight of two.',
  'day-discussion': 'The village square is yours. Speak carefully: truth and lies wear the same face.',
  'day-vote': 'On my signal, cast your judgement. The accused will not see the tally until it is sealed.',
  'day-result': 'The village has spoken. Turn the condemned card and remember what this judgement cost.'
};

export const assetForRole = roleId => ROLES[roleId]?.image || ROLES.villager.image;

