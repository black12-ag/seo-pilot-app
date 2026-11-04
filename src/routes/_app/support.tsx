import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { HELP_PATHS } from "@/shared/product-help";
import { SUPPORT_EMAIL } from "@/client/lib/support";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            Help & Support
          </p>
          <PageHeader
            title="We want to hear from you"
            description="Find setup guidance or report a problem with SEO Pilot."
          />
        </div>

        <div className="space-y-3">
          <SupportLinkCard
            href={HELP_PATHS.home}
            title="Setup and help"
            description="Find setup instructions and troubleshooting guides."
            cta="Open help"
          />

          <SupportLinkCard
            href={`mailto:${SUPPORT_EMAIL}`}
            title="Email support"
            description="Report a bug or ask for a feature."
            cta="Send an email"
          />
        </div>
      </div>
    </div>
  );
}

function SupportLinkCard({
  href,
  title,
  description,
  cta,
}: {
  href: string;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <a href={href} className="group block">
      <Card className="transition-colors group-hover:border-foreground/20">
        <CardHeader>
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="font-medium">
          {cta} <span aria-hidden="true">&rarr;</span>
        </CardContent>
      </Card>
    </a>
  );
}
