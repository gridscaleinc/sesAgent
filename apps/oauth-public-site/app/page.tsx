import { HomePage, metadataFor } from './site-pages'

export const metadata = metadataFor('en', 'home')
export default function Home() { return <HomePage locale="en" /> }
