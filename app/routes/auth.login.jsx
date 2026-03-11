import { useState } from "react";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { json, redirect } from "@remix-run/node";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "../../app/shopify.server.js";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const errors = login === undefined ? "api-credentials-not-set" : [];
  return json({ errors, polarisTranslations: require("@shopify/polaris/locales/es.json") });
};

export const action = async ({ request }) => {
  const errors = await login(request);
  if (errors?.shop) {
    return json({ errors });
  }
  return redirect(`/app`);
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");

  const { errors } = actionData || loaderData;

  return (
    <AppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                BH Shopify ERP - Acceso
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Dominio de la tienda"
                helpText="Ejemplo: mi-tienda.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors?.shop && "Ingresa un dominio de tienda válido"}
              />
              <Button submit>Ingresar</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
