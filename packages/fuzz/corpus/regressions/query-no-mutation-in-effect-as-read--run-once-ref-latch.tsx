// rule: query-no-mutation-in-effect-as-read
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (payment redirect: a genuine one-shot write gated by a run-once ref latch, not a read dressed as a mutation)
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShopperOrdersMutation } from "./commerce-hooks";

export const PaymentProcessing = ({ order }: { order: { orderNo: string } }) => {
  const { mutateAsync: updatePaymentInstrumentForOrder } = useShopperOrdersMutation(
    "updatePaymentInstrumentForOrder",
  );
  const isHandled = useRef(false);
  const navigate = useNavigate();

  const handleAdyenRedirect = useCallback(
    async (currentOrder: { orderNo: string }) => {
      const updatedOrder = await updatePaymentInstrumentForOrder({
        parameters: { orderNo: currentOrder.orderNo },
      });
      return updatedOrder.paymentInstruments.length > 0;
    },
    [updatePaymentInstrumentForOrder],
  );

  useEffect(() => {
    (async () => {
      if (isHandled.current) {
        return;
      }
      isHandled.current = true;
      const success = await handleAdyenRedirect(order);
      if (success) navigate("/confirmation");
    })();
  }, [order, navigate, handleAdyenRedirect]);

  return null;
};
