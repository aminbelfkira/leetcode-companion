import { describe, expect, it } from "vitest";
import {
  acceptedVerdictFromGraphqlResponse,
  collectionSlugFromSearch,
  isAcceptedVerdict,
  isFinalCheckResponse,
  parseCheckEndpoint,
  parseSubmitEndpoint,
  problemSlugFromPathname,
  submissionIdFromGraphqlRequestBody,
  submissionIdFromResponse,
} from "../src/lc-endpoints";

describe("détection LeetCode", () => {
  it("reconnaît uniquement le véritable endpoint Submit", () => {
    expect(parseSubmitEndpoint("/problems/two-sum/submit/")).toEqual({ slug: "two-sum" });
    expect(parseSubmitEndpoint("https://leetcode.com/problems/two-sum/submit/?x=1")).toEqual({
      slug: "two-sum",
    });
    expect(parseSubmitEndpoint("/problems/two-sum/interpret_solution/")).toBeNull();
  });

  it("corrèle les ids de soumission et de verdict", () => {
    expect(submissionIdFromResponse({ submission_id: 123 })).toBe("123");
    expect(submissionIdFromResponse({ data: { submission_id: "00123" } })).toBe("123");
    expect(parseCheckEndpoint("/submissions/detail/00123/check/")).toEqual({ id: "123" });
  });

  it("ne lit pas une requête GraphQL contenant du code", () => {
    expect(submissionIdFromGraphqlRequestBody('{"variables":{"submissionId":"123"}}')).toBe(
      "123",
    );
    expect(
      submissionIdFromGraphqlRequestBody(
        '{"variables":{"submissionId":"123","typedCode":"return true"}}',
      ),
    ).toBeNull();
  });

  it("valide un Accepted terminal avec le code 10", () => {
    expect(isFinalCheckResponse({ state: "SUCCESS" })).toBe(true);
    expect(isFinalCheckResponse({ state: "PENDING" })).toBe(false);
    expect(isAcceptedVerdict("Accepted", 10)).toBe(true);
    expect(isAcceptedVerdict("Accepted", 11)).toBe(false);
    expect(isAcceptedVerdict("Wrong Answer", 10)).toBe(false);
  });

  it("reconnaît le verdict GraphQL moderne sans parcourir des champs arbitraires", () => {
    expect(
      acceptedVerdictFromGraphqlResponse({ data: { submissionDetails: { statusCode: 10 } } }),
    ).toMatchObject({ status_msg: "Accepted", status_code: 10 });
    expect(acceptedVerdictFromGraphqlResponse({ unrelated: { statusCode: 10 } })).toBeNull();
  });
});

describe("URLs LeetCode", () => {
  it("extrait le problème et le contexte de Study Plan", () => {
    expect(problemSlugFromPathname("/problems/two-sum/description/")).toBe("two-sum");
    expect(problemSlugFromPathname("/problemset/")).toBeNull();
    expect(
      collectionSlugFromSearch("?envType=study-plan-v2&envId=Top-Interview-150"),
    ).toBe("top-interview-150");
    expect(collectionSlugFromSearch("?envId=top-interview-150")).toBeNull();
  });
});
