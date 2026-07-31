import { AuthenticationPortal } from "./components/AuthenticationPortal";
import { PublicChatPage } from "./components/PublicChatPage";
import { useRouter } from "./routing/RouterProvider";
import { GuidedSetupFoundation } from "./components/GuidedSetupFoundation";

export default function App(): React.JSX.Element {
  const { appRoute } = useRouter();
  if (appRoute.kind === "public" && appRoute.name === "chat") return <PublicChatPage connectionPublicId={appRoute.connectionPublicId} />;
  if (appRoute.kind === "public") return <GuidedSetupFoundation />;
  return <AuthenticationPortal/>;
}
