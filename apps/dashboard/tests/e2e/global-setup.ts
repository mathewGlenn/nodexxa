import { setup, teardown } from '../integration/global-setup'

export default async function globalSetup() {
  await setup()
  return teardown
}
