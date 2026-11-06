"use client";
import {useParams} from "next/navigation";
import WorkspacePlaceholderPage from "../../../components/workspace-placeholder-page";
export default function AdminSectionPage(){const p=useParams<{section:string[]}>();return <WorkspacePlaceholderPage routeKey={"admin/"+(p.section??[]).join("/")}/>;}
