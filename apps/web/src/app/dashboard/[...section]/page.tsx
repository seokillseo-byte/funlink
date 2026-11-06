"use client";
import {useParams} from "next/navigation";
import WorkspacePlaceholderPage from "../../../components/workspace-placeholder-page";
export default function DashboardSectionPage(){const p=useParams<{section:string[]}>();return <WorkspacePlaceholderPage routeKey={"dashboard/"+(p.section??[]).join("/")}/>;}
