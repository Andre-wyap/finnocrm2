import InviteForm from './InviteForm'

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  return <InviteForm token={params.token ?? ''} />
}
