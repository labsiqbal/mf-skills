// MFM-044: follower-milestone (creator-01) passes the seed acceptance.
import { seedAcceptance } from '../message-cascade/seed-acceptance';

seedAcceptance('follower-milestone', { category: 'creator', uses: ['overlay', 'broll'] });
