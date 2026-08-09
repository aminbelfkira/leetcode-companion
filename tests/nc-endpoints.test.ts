import { describe, expect, it } from "vitest";
import {
  isAcceptedVerdict,
  listSlugFromSearch,
  parseDifficulty,
  problemSlugFromPathname,
  reviewProblemUrl,
  submitKindForRequest,
  verdictFromResponse,
} from "../src/nc-endpoints";

/** Réponse réelle de NeetCode, réduite aux champs lus. */
function response(description: string, correct = 20, total = 20): string {
  return JSON.stringify({
    data: {
      status: { id: 3, description },
      test_case_count: total,
      correct_test_case_count: correct,
      stdout: "",
      memory: 17_432,
      date: "2026-08-09T18:00:00.000Z",
    },
  });
}

const CODE_BODY = JSON.stringify({
  data: { problemId: "duplicate-integer", rawCode: "class Solution: pass", lang: "python" },
});

describe("submitKindForRequest", () => {
  it("reconnaît une soumission de code", () => {
    expect(submitKindForRequest("POST", "/api/executeCodeFunctionHttp", CODE_BODY)).toBe("code");
  });

  it("accepte l'URL absolue et une query string", () => {
    expect(
      submitKindForRequest("POST", "https://neetcode.io/api/executeCodeFunctionHttp?x=1", null),
    ).toBe("code");
  });

  it("ignore le bouton Run", () => {
    expect(submitKindForRequest("POST", "/api/runCodeFunctionHttp", CODE_BODY)).toBeNull();
  });

  it("ignore les autres endpoints et les autres méthodes", () => {
    expect(submitKindForRequest("POST", "/api/getProblemMetadataFunctionHttp", null)).toBeNull();
    expect(submitKindForRequest("GET", "/api/executeCodeFunctionHttp", null)).toBeNull();
    expect(submitKindForRequest("POST", "pas une url", null)).toBeNull();
  });

  it("départage le Run et le Submit SQL par runOnly", () => {
    const sql = (runOnly: boolean) =>
      JSON.stringify({ data: { problemId: "x", rawCode: "SELECT 1;", runOnly } });
    expect(submitKindForRequest("POST", "/api/runSqlFunctionHttp", sql(false))).toBe("sql");
    expect(submitKindForRequest("POST", "/api/runSqlFunctionHttp", sql(true))).toBeNull();
  });

  it("ne prend pas un SQL sans corps lisible pour une soumission", () => {
    expect(submitKindForRequest("POST", "/api/runSqlFunctionHttp", null)).toBeNull();
    expect(submitKindForRequest("POST", "/api/runSqlFunctionHttp", "{pas du json")).toBeNull();
  });

  it("n'est pas trompé par du code contenant runOnly", () => {
    const body = JSON.stringify({
      data: { problemId: "x", rawCode: '-- "runOnly":false', runOnly: true },
    });
    expect(submitKindForRequest("POST", "/api/runSqlFunctionHttp", body)).toBeNull();
  });
});

describe("verdictFromResponse", () => {
  it("extrait le verdict et le décompte de tests", () => {
    expect(verdictFromResponse(response("Accepted"))).toEqual({
      statusDescription: "Accepted",
      testCaseCount: 20,
      correctTestCaseCount: 20,
    });
  });

  it("remonte aussi un échec", () => {
    const verdict = verdictFromResponse(response("Wrong Answer", 7, 20));
    expect(verdict?.statusDescription).toBe("Wrong Answer");
    expect(verdict?.correctTestCaseCount).toBe(7);
  });

  it("renvoie null sur une réponse inexploitable", () => {
    expect(verdictFromResponse("")).toBeNull();
    expect(verdictFromResponse("{}")).toBeNull();
    expect(verdictFromResponse(JSON.stringify({ data: {} }))).toBeNull();
    expect(verdictFromResponse(JSON.stringify({ data: { status: {} } }))).toBeNull();
  });

  it("tolère l'absence de décompte de tests", () => {
    const verdict = verdictFromResponse(
      JSON.stringify({ data: { status: { description: "Accepted" } } }),
    );
    expect(verdict).toEqual({
      statusDescription: "Accepted",
      testCaseCount: null,
      correctTestCaseCount: null,
    });
  });
});

describe("isAcceptedVerdict", () => {
  it("accepte le libellé exact, espaces et casse mis à part", () => {
    expect(isAcceptedVerdict("Accepted")).toBe(true);
    expect(isAcceptedVerdict("  accepted ")).toBe(true);
  });

  it("rejette tout le reste", () => {
    for (const value of ["Wrong Answer", "Time Limit Exceeded", "", null, undefined, 10]) {
      expect(isAcceptedVerdict(value)).toBe(false);
    }
  });
});

describe("URLs de problème", () => {
  it("extrait le slug de toutes les sous-pages", () => {
    expect(problemSlugFromPathname("/problems/duplicate-integer")).toBe("duplicate-integer");
    expect(problemSlugFromPathname("/problems/duplicate-integer/question")).toBe(
      "duplicate-integer",
    );
    expect(problemSlugFromPathname("/problems/duplicate-integer/submissions")).toBe(
      "duplicate-integer",
    );
  });

  it("renvoie null hors des pages problème", () => {
    expect(problemSlugFromPathname("/practice")).toBeNull();
    expect(problemSlugFromPathname("/")).toBeNull();
  });

  it("construit une URL de révision sur l'onglet question", () => {
    expect(reviewProblemUrl("duplicate-integer")).toBe(
      "https://neetcode.io/problems/duplicate-integer/question",
    );
  });
});

describe("listSlugFromSearch", () => {
  it("lit le contexte de liste", () => {
    expect(listSlugFromSearch("?list=neetcode150")).toBe("neetcode150");
    expect(listSlugFromSearch("?tab=x&list=NeetCode250")).toBe("neetcode250");
  });

  it("rejette l'absence de liste ou une valeur douteuse", () => {
    expect(listSlugFromSearch("")).toBeNull();
    expect(listSlugFromSearch("?list=")).toBeNull();
    expect(listSlugFromSearch("?list=../etc")).toBeNull();
  });
});

describe("parseDifficulty", () => {
  it("ne garde que les trois valeurs connues", () => {
    expect(parseDifficulty("Easy")).toBe("Easy");
    expect(parseDifficulty("Medium")).toBe("Medium");
    expect(parseDifficulty("Hard")).toBe("Hard");
    expect(parseDifficulty("easy")).toBe("Unknown");
    expect(parseDifficulty(undefined)).toBe("Unknown");
  });
});
